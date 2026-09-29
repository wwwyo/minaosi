#!/usr/bin/env python3
"""brand.css の機械可読チェック。

未定義の custom property 参照とコントラスト比不足を検出する。
brand-css-check.py <brand.css> [scan paths...] [--json]

新設する product-design 型 skill の tools/ にコピーして使う。詳細は README.md 参照。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SCAN_EXTENSIONS = {".css", ".html", ".tsx", ".jsx", ".vue", ".svelte"}

CUSTOM_PROP_DEF_RE = re.compile(r"(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);")
VAR_REF_RE = re.compile(r"var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)")
RULE_BLOCK_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

HEX_RE = re.compile(r"^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB_RE = re.compile(
    r"^rgba?\(\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)"
    r"(?:\s*[,/]\s*([\d.]+)(%?))?[\s]*\)$"
)
OKLCH_RE = re.compile(
    r"^oklch\(\s*([\d.]+)(%?)\s+([\d.]+|none)\s+([\d.]+|none)"
    r"(?:\s*/\s*([\d.]+)(%?))?\s*\)$"
)


def oklch_to_srgb(l_val: float, l_pct: bool, c_val: float, h_val: float) -> tuple[float, float, float]:
    """OKLCH → sRGB (0-255)。CSS 値域: L は 0-1 または %、C は 0 以上、H は度。"""
    import math
    L = l_val / 100.0 if l_pct else l_val
    a = c_val * math.cos(math.radians(h_val))
    b = c_val * math.sin(math.radians(h_val))

    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541729 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l3, m3, s3 = l_ ** 3, m_ ** 3, s_ ** 3

    # OKLab → linear sRGB
    r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
    g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
    bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3

    def to_gamma(c: float) -> float:
        c = min(1.0, max(0.0, c))
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

    return (to_gamma(r) * 255, to_gamma(g) * 255, to_gamma(bl) * 255)


@dataclass
class Finding:
    rule: str
    severity: str
    file: str
    line: int
    text: str
    hint: str

    def as_dict(self) -> dict:
        return {
            "rule": self.rule,
            "severity": self.severity,
            "file": self.file,
            "line": self.line,
            "text": self.text,
            "hint": self.hint,
        }


def strip_comments(css: str) -> str:
    """CSS コメントを解析前に除去する（コメント内の var/property 定義を誤検出しないため）。

    改行は保持して行番号を保つ。
    """
    def replace_comment(m):
        return "\n" * m.group(0).count("\n")
    return COMMENT_RE.sub(replace_comment, css)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def parse_rules_from_blocks(css: str, base: int = 0) -> list[tuple[str, str, int]]:
    """CSS を brace カウントで解析し、通常 rule の (selector, body, start_offset) を返す。

    at-rule（@media / @supports 等）は外側 block を剥がして中の rule を返す。
    文字列リテラル内の `{` `}` `;` は無視する。offset は元の css 先頭からの位置。
    """
    n = len(css)

    def skip_string(j: int) -> int:
        quote = css[j]
        j += 1
        while j < n and css[j] != quote:
            j += 2 if css[j] == "\\" else 1
        return j + 1

    def block_end(j: int) -> int:
        depth = 0
        while j < n:
            c = css[j]
            if c in "\"'":
                j = skip_string(j)
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return n

    rules: list[tuple[str, str, int]] = []
    i = 0
    while i < n:
        if css[i].isspace():
            i += 1
            continue
        start = i
        while i < n and css[i] not in "{;":
            i = skip_string(i) if css[i] in "\"'" else i + 1
        if i >= n:
            break
        if css[i] == ";":
            i += 1
            continue
        prelude = css[start:i].strip()
        end = block_end(i)
        body = css[i + 1 : end]
        if prelude.startswith("@"):
            rules.extend(parse_rules_from_blocks(body, base + i + 1))
        elif prelude:
            rules.append((prelude, body.strip(), base + start))
        i = end + 1
    return rules


def parse_custom_properties(css: str) -> dict[str, tuple[str, int]]:
    """`--name: value;` の定義を { name: (value, line) } で返す。後勝ちで上書きする。"""
    props: dict[str, tuple[str, int]] = {}
    for m in CUSTOM_PROP_DEF_RE.finditer(css):
        name, value = m.group(1), m.group(2).strip()
        props[name] = (value, line_of(css, m.start()))
    return props


def find_var_refs(css: str) -> list[tuple[str, str | None, int, str]]:
    """`var(--name[, fallback])` の出現を (name, fallback, line, matched_text) で返す。"""
    refs = []
    for m in VAR_REF_RE.finditer(css):
        name = m.group(1)
        fallback = m.group(2)
        refs.append((name, fallback.strip() if fallback else None, line_of(css, m.start()), m.group(0)))
    return refs


def find_var_refs_in_fallback(fallback: str) -> list[tuple[str, str | None]]:
    """fallback テキスト内の var 参照を再帰的に抽出する。

    Returns: [(name, nested_fallback), ...]
    """
    refs = []
    for m in VAR_REF_RE.finditer(fallback):
        name = m.group(1)
        nested_fallback = m.group(2)
        refs.append((name, nested_fallback.strip() if nested_fallback else None))
        if nested_fallback:
            refs.extend(find_var_refs_in_fallback(nested_fallback))
    return refs


def resolve_color(value: str, props: dict[str, tuple[str, int]], _seen: frozenset[str] = frozenset()) -> tuple[float, float, float] | None:
    """色値を (r, g, b) の 0-255 タプルへ解決する。解決不能なら None。

    alpha < 1 の場合も None を返す（合成が必要なため判定できない）。
    """
    value = value.strip()

    m = VAR_REF_RE.fullmatch(value)
    if m:
        name = m.group(1)
        if name in _seen:
            return None
        if name in props:
            return resolve_color(props[name][0], props, _seen | {name})
        fallback = m.group(2)
        if fallback:
            return resolve_color(fallback.strip(), props, _seen | {name})
        return None

    hex_m = HEX_RE.match(value)
    if hex_m:
        h = hex_m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        channels = [int(h[i : i + 2], 16) for i in range(0, len(h), 2)]
        if len(channels) == 4 and channels[3] < 255:
            return None
        return tuple(channels[:3])

    rgb_m = RGB_RE.match(value)
    if rgb_m:
        r_str, r_pct, g_str, g_pct, b_str, b_pct, a_str, a_pct = rgb_m.groups()

        # Parse RGB values
        try:
            r = float(r_str)
            g = float(g_str)
            b = float(b_str)
        except ValueError:
            return None

        # Convert percentage to 0-255
        if r_pct:
            r = r * 2.55
        if g_pct:
            g = g * 2.55
        if b_pct:
            b = b * 2.55

        # Check ranges
        if not (0 <= r <= 255) or not (0 <= g <= 255) or not (0 <= b <= 255):
            return None

        # Check alpha
        if a_str is not None:
            try:
                a = float(a_str)
            except ValueError:
                return None
            if a_pct:
                a = a / 100.0
            if a < 1.0:
                return None

        return (r, g, b)

    oklch_m = OKLCH_RE.match(value)
    if oklch_m:
        l_str, l_pct, c_str, h_str, a_str, a_pct = oklch_m.groups()
        if a_str is not None:
            try:
                a = float(a_str)
            except ValueError:
                return None
            if a_pct:
                a = a / 100.0
            if a < 1.0:
                return None
        try:
            l_val = float(l_str)
            c_val = 0.0 if c_str == "none" else float(c_str)
            h_val = 0.0 if h_str == "none" else float(h_str)
        except ValueError:
            return None
        return oklch_to_srgb(l_val, bool(l_pct), c_val, h_val)

    return None


def relative_luminance(rgb: tuple[float, float, float]) -> float:
    """WCAG の相対輝度を計算する。"""

    def channel(c: float) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(rgb1: tuple[float, float, float], rgb2: tuple[float, float, float]) -> float:
    l1, l2 = relative_luminance(rgb1), relative_luminance(rgb2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def rule_undefined_and_fallback_var(css: str, filename: str, all_props: dict[str, tuple[str, int]]) -> list[Finding]:
    findings = []
    for name, fallback, ln, matched in find_var_refs(css):
        if name in all_props:
            # Check for undefined vars in fallback recursively
            if fallback:
                for fb_name, _ in find_var_refs_in_fallback(fallback):
                    if fb_name not in all_props:
                        findings.append(
                            Finding(
                                "undefined-var",
                                "error",
                                filename,
                                ln,
                                matched,
                                f"{fb_name} が fallback 内で参照されているが未定義",
                            )
                        )
            continue
        if fallback is not None:
            findings.append(
                Finding(
                    "fallback-var",
                    "warning",
                    filename,
                    ln,
                    matched,
                    f"--{name.lstrip('-')} が未定義。fallback 値 {fallback!r} がそのまま描画され続ける可能性がある",
                )
            )
            # Also check for undefined vars in fallback
            for fb_name, _ in find_var_refs_in_fallback(fallback):
                if fb_name not in all_props:
                    findings.append(
                        Finding(
                            "undefined-var",
                            "error",
                            filename,
                            ln,
                            matched,
                            f"{fb_name} が fallback 内で参照されているが未定義",
                        )
                    )
        else:
            findings.append(
                Finding(
                    "undefined-var",
                    "error",
                    filename,
                    ln,
                    matched,
                    f"{name} を brand.css または scan 対象のどこにも定義していない",
                )
            )
    return findings


def rule_contrast_same_block(css: str, filename: str, all_props: dict[str, tuple[str, int]]) -> tuple[list[Finding], set[str]]:
    """同一 rule block 内の color / background(-color) の組をコントラスト判定する。

    入れ子 block（@media など）内の rule も検査する。
    """
    findings: list[Finding] = []
    unresolved_reported: set[str] = set()
    rules = parse_rules_from_blocks(css)

    for selector, body, start_offset in rules:
        if not body.endswith(";"):
            body += ";"
        # CSS は後の宣言が勝つので最後のマッチを採用する
        color_m = list(re.finditer(r"(?<![-\w])color\s*:\s*([^;]+);", body))
        bg_m = list(re.finditer(r"background(?:-color)?\s*:\s*([^;]+);", body))
        if not color_m or not bg_m:
            continue
        color_val, bg_val = color_m[-1].group(1).strip(), bg_m[-1].group(1).strip()
        ln = line_of(css, start_offset)

        color_rgb = resolve_color(color_val, all_props)
        bg_rgb = resolve_color(bg_val, all_props)

        if color_rgb is None:
            key = f"{filename}:{ln}:{color_val}"
            if key not in unresolved_reported:
                unresolved_reported.add(key)
                findings.append(
                    Finding("unresolved-color", "info", filename, ln, color_val, "解決不能な色値のためコントラスト判定を skip した")
                )
        if bg_rgb is None:
            key = f"{filename}:{ln}:{bg_val}"
            if key not in unresolved_reported:
                unresolved_reported.add(key)
                findings.append(
                    Finding("unresolved-color", "info", filename, ln, bg_val, "解決不能な色値のためコントラスト判定を skip した")
                )
        if color_rgb is None or bg_rgb is None:
            continue

        ratio = contrast_ratio(color_rgb, bg_rgb)
        if ratio < 4.5:
            findings.append(
                Finding(
                    "contrast-ratio",
                    "warning",
                    filename,
                    ln,
                    f"{selector} {{ color: {color_val}; background: {bg_val}; }}",
                    f"WCAG AA 4.5:1 未満（実測 {ratio:.2f}:1）",
                )
            )
    return findings, unresolved_reported


def rule_contrast_on_naming(
    filename: str, all_props: dict[str, tuple[str, int]], already_unresolved: set[str]
) -> list[Finding]:
    """`--on-<name>` / `--<name>` 命名規約のペアをコントラスト判定する。"""
    findings: list[Finding] = []
    names = set(all_props.keys())

    for name in sorted(names):
        stripped = name.lstrip("-")
        idx = stripped.find("on-")
        if idx == -1:
            continue
        # prefix (--color-on-primary → prefix="color-", base="primary") を許容する
        prefix = stripped[:idx]
        base_key = stripped[idx + len("on-"):]
        base_name = f"--{prefix}{base_key}"
        if base_name not in all_props or base_name == name:
            continue

        on_val, on_line = all_props[name]
        base_val, base_line = all_props[base_name]
        on_rgb = resolve_color(on_val, all_props)
        base_rgb = resolve_color(base_val, all_props)

        if on_rgb is None or base_rgb is None:
            for val, ln in ((on_val, on_line), (base_val, base_line)):
                if resolve_color(val, all_props) is None:
                    key = f"{filename}:{ln}:{val}"
                    if key not in already_unresolved:
                        already_unresolved.add(key)
                        findings.append(
                            Finding("unresolved-color", "info", filename, ln, val, "解決不能な色値のためコントラスト判定を skip した")
                        )
            continue

        ratio = contrast_ratio(on_rgb, base_rgb)
        if ratio < 4.5:
            findings.append(
                Finding(
                    "contrast-ratio",
                    "warning",
                    filename,
                    on_line,
                    f"{name}: {on_val}; /* on {base_name}: {base_val} */",
                    f"WCAG AA 4.5:1 未満（実測 {ratio:.2f}:1）",
                )
            )
    return findings


def rule_token_summary(filename: str, defined_count: int, ref_count: int) -> Finding:
    return Finding(
        "token-summary",
        "info",
        filename,
        1,
        f"defined={defined_count} refs={ref_count}",
        "custom property の定義数と参照数のサマリ",
    )


def iter_scan_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for p in paths:
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            for ext in SCAN_EXTENSIONS:
                files.extend(sorted(p.rglob(f"*{ext}")))
    return files


def run_check(brand_css_path: Path, scan_paths: list[Path]) -> list[Finding]:
    brand_css_text = strip_comments(brand_css_path.read_text(encoding="utf-8"))

    scan_files = [brand_css_path] + [f for f in iter_scan_files(scan_paths) if f.resolve() != brand_css_path.resolve()]

    # 全ファイル横断で custom property 定義を集約する（brand.css 以外での定義も許容するため）。
    all_props: dict[str, tuple[str, int]] = {}
    file_texts: dict[Path, str] = {}
    for f in scan_files:
        try:
            text = strip_comments(f.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            continue
        file_texts[f] = text
        # brand.css 自身の行番号を保つため、定義元ファイルの props は brand.css のものを優先しつつ他ファイルでもマージする。
        for name, (value, ln) in parse_custom_properties(text).items():
            if name not in all_props:
                all_props[name] = (value, ln)

    findings: list[Finding] = []
    total_refs = 0

    for f, text in file_texts.items():
        rel = str(f)
        findings.extend(rule_undefined_and_fallback_var(text, rel, all_props))
        total_refs += len(find_var_refs(text))

        if f.suffix == ".css":
            block_findings, unresolved = rule_contrast_same_block(text, rel, all_props)
            findings.extend(block_findings)
            if f == brand_css_path:
                findings.extend(rule_contrast_on_naming(rel, all_props, unresolved))

    findings.append(rule_token_summary(str(brand_css_path), len(all_props), total_refs))

    return findings


def format_human(f: Finding) -> str:
    return f"{f.severity} {f.rule} {f.file}:{f.line} {f.text} — {f.hint}"


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: brand-css-check.py <brand.css> [scan paths...] [--json]", file=sys.stderr)
        return 2

    as_json = "--json" in argv
    positional = [a for a in argv if a != "--json"]

    brand_css_path = Path(positional[0])
    if not brand_css_path.is_file():
        print(f"error: {brand_css_path} が見つからない", file=sys.stderr)
        return 2

    scan_paths = [Path(p) for p in positional[1:]] if len(positional) > 1 else [brand_css_path]
    if brand_css_path not in scan_paths:
        scan_paths = [brand_css_path] + scan_paths

    findings = run_check(brand_css_path, scan_paths)

    if as_json:
        for f in findings:
            print(json.dumps(f.as_dict(), ensure_ascii=False))
    else:
        for f in findings:
            print(format_human(f))

    return 1 if any(f.severity == "error" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
