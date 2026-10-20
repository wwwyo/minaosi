#!/usr/bin/env bun
/**
 * 依存パッケージが宣言した peerDependencies を、実際に解決される版が満たしているか検証する。
 *
 * bun は満たさない peer を `warn: incorrect peer dependency` として出すだけで exit 0 する
 * ため、adapter だけが先に上がって本体が古いままの状態が CI を通過してしまう。
 * ここでは各 workspace の宣言済み依存から peer を辿り、そのコードが実際に解決する版で
 * 判定して、満たさないものを失敗にする。
 *
 * 使い方: bun scripts/check-peers.ts
 */
import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

type Pkg = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

type Violation = {
  workspace: string
  dependent: string
  dependentVersion: string
  peer: string
  required: string
  installed: string | null
}

const root = resolve(import.meta.dir, '..')

async function readPkg(file: string): Promise<Pkg | null> {
  const f = Bun.file(file)
  if (!(await f.exists())) return null
  return (await f.json()) as Pkg
}

/** base から見た name/package.json の解決を試し、解決先の package.json を dir とともに返す */
async function resolvePkg(name: string, base: string): Promise<{ dir: string; pkg: Pkg } | null> {
  let file: string
  try {
    file = Bun.resolveSync(`${name}/package.json`, base)
  } catch {
    return null
  }
  const pkg = await readPkg(file)
  if (!pkg) return null
  return { dir: dirname(file), pkg }
}

function satisfies(version: string, range: string): boolean | null {
  try {
    return Bun.semver.satisfies(version, range)
  } catch {
    // non-semver な range（workspace:*, catalog:, file: など）はこの検査の対象外
    return null
  }
}

const workspaces = readdirSync(join(root, 'apps'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join(root, 'apps', e.name))
  .filter((dir) => {
    try {
      readdirSync(dir)
      return true
    } catch {
      return false
    }
  })

const violations: Violation[] = []
const checked = new Set<string>()

for (const wsDir of workspaces) {
  const ws = await readPkg(join(wsDir, 'package.json'))
  if (!ws) continue
  const wsName = ws.name ?? relative(root, wsDir)

  // 実際に読み込まれる依存（prod / optional / dev）を対象にする
  const declared = new Set([
    ...Object.keys(ws.dependencies ?? {}),
    ...Object.keys(ws.optionalDependencies ?? {}),
    ...Object.keys(ws.devDependencies ?? {}),
  ])

  for (const name of declared) {
    const dep = await resolvePkg(name, wsDir)
    if (!dep) continue
    const peers = dep.pkg.peerDependencies
    if (!peers) continue

    for (const [peer, range] of Object.entries(peers)) {
      if (dep.pkg.peerDependenciesMeta?.[peer]?.optional) continue

      const key = `${wsName}\0${name}\0${dep.pkg.version}\0${peer}\0${range}`
      if (checked.has(key)) continue
      checked.add(key)

      // 依存パッケージ自身の解決位置を優先し、無ければ workspace から解決する
      const resolved = (await resolvePkg(peer, dep.dir)) ?? (await resolvePkg(peer, wsDir))
      const installed = resolved?.pkg.version ?? null
      if (installed === null) {
        violations.push({
          workspace: wsName,
          dependent: name,
          dependentVersion: dep.pkg.version ?? '?',
          peer,
          required: range,
          installed: null,
        })
        continue
      }

      const ok = satisfies(installed, range)
      if (ok === false) {
        violations.push({
          workspace: wsName,
          dependent: name,
          dependentVersion: dep.pkg.version ?? '?',
          peer,
          required: range,
          installed,
        })
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`peerDependencies: ${checked.size} 件の組み合わせを確認、不整合なし`)
  process.exit(0)
}

console.error('peerDependencies が満たされていません:\n')
for (const v of violations) {
  const actual = v.installed === null ? '未インストール' : v.installed
  console.error(
    `  ${v.workspace}: ${v.dependent}@${v.dependentVersion} は ${v.peer}@${v.required} を要求 → 実際は ${actual}`,
  )
}
console.error(
  '\n解決方法: peer を要求する側と同じ系列のパッケージを、満たす版まで同時に上げてください' +
    '（例: @tanstack/ai-cloudflare を上げるなら @tanstack/ai も ^0.68.0 以上へ）。',
)
process.exit(1)
