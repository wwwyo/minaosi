import { isReviewProvider, type ReviewMode, type ReviewProvider } from '../minaosi/review/providers';
import { reviewModeItem, providerItem, PROVIDER_SETTINGS, styleGuideItem } from '../minaosi/store';
import { readStyleGuideFile, type SavedStyleGuide } from '../minaosi/style-guide';
import { providerForModel } from '../minaosi/review/models';
import { PANEL_CSS } from '../minaosi/ui/styles';
import wordmark from '../../assets/wordmark.svg?raw';
import './style.css';

const style = document.createElement('style');
style.textContent = PANEL_CSS;
document.head.prepend(style);
document.querySelector('#brand')!.innerHTML = wordmark;
const form = document.querySelector<HTMLFormElement>('#settings')!;
const fields = document.querySelector<HTMLFieldSetElement>('#byok-fields')!;
const model = document.querySelector<HTMLInputElement>('#model')!;
const key = document.querySelector<HTMLInputElement>('#api-key')!;
const status = document.querySelector<HTMLElement>('#status')!;
const save = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
const radios = [...form.querySelectorAll<HTMLInputElement>('[name="mode"]')];
const guideFields = document.querySelector<HTMLFieldSetElement>('#style-guide-fields')!;
const guideFile = document.querySelector<HTMLInputElement>('#style-guide-file')!;
const guideName = document.querySelector<HTMLElement>('#style-guide-name')!;
const guidePreview = document.querySelector<HTMLElement>('#style-guide-preview')!;
const guideDetails = document.querySelector<HTMLDetailsElement>('#style-guide-details')!;
const clearGuide = document.querySelector<HTMLButtonElement>('#clear-style-guide')!;
let guide: SavedStyleGuide | null = null;
let readingGuide = false;
function showGuide() {
  guideName.textContent = guide ? `${guide.name}（${guide.content.length.toLocaleString()}文字）` : '未設定';
  guidePreview.textContent = guide?.content ?? '';
  guideDetails.hidden = !guide;
  clearGuide.disabled = !guide;
}
const drafts: Record<ReviewProvider, { key: string; model: string }> = {
  anthropic: { key: '', model: 'claude-sonnet-5' },
  openai: { key: '', model: 'gpt-5.4-mini' },
  deepseek: { key: '', model: 'deepseek-flash' },
};
let provider: ReviewProvider = 'anthropic';
let saving = false;
const dirtyProviders = new Set<ReviewProvider>();
const mode = (): ReviewMode => radios.find((radio) => radio.checked)?.value === 'byok' ? 'byok' : 'default';
function showMode() {
  fields.hidden = mode() !== 'byok';
  fields.disabled = fields.hidden || saving;
  document.querySelector<HTMLElement>('#standard-data-use')!.hidden = mode() === 'byok';
  document.querySelector<HTMLElement>('#byok-data-use')!.hidden = mode() !== 'byok';
}
function stash() { drafts[provider] = { key: key.value, model: model.value }; dirtyProviders.add(provider); }
function loadDraft() { key.value = drafts[provider].key; model.value = drafts[provider].model; }

try {
  const [savedMode, savedProvider, anthropicKey, anthropicModel, openaiKey, openaiModel, deepseekKey, deepseekModel, savedGuide] = await Promise.all([
    reviewModeItem.getValue(), providerItem.getValue(), PROVIDER_SETTINGS.anthropic.key.getValue(),
    PROVIDER_SETTINGS.anthropic.model.getValue(), PROVIDER_SETTINGS.openai.key.getValue(), PROVIDER_SETTINGS.openai.model.getValue(),
    PROVIDER_SETTINGS.deepseek.key.getValue(), PROVIDER_SETTINGS.deepseek.model.getValue(),
    styleGuideItem.getValue(),
  ]);
  provider = isReviewProvider(savedProvider) ? savedProvider : 'anthropic';
  drafts.anthropic = { key: anthropicKey, model: anthropicModel || 'claude-sonnet-5' };
  drafts.openai = { key: openaiKey, model: openaiModel || 'gpt-5.4-mini' };
  drafts.deepseek = { key: deepseekKey, model: deepseekModel || 'deepseek-flash' };
  loadDraft();
  guide = savedGuide;
  guideFields.disabled = false;
  showGuide();
  for (const radio of radios) { radio.checked = radio.value === (savedMode === 'byok' ? 'byok' : 'default'); radio.disabled = false; }
  save.disabled = false;
  status.textContent = '';
  showMode();
} catch {
  status.textContent = '設定を読み込めませんでした。ページを開き直してください。';
}
for (const radio of radios) radio.addEventListener('change', () => { showMode(); status.textContent = ''; });
model.addEventListener('input', () => {
  model.setCustomValidity('');
  const next = providerForModel(model.value.trim());
  if (next && next !== provider) {
    // 他社のキーを新しいモデルへ送らず、接続先ごとの入力を保持する。
    drafts[provider].key = key.value;
    provider = next;
    key.value = drafts[next].key;
  }
  stash();
  status.textContent = '';
});
key.addEventListener('input', () => { stash(); status.textContent = ''; });
guideFile.addEventListener('change', async () => {
  const file = guideFile.files?.[0];
  if (!file || readingGuide || saving) return;
  readingGuide = true;
  guideFields.disabled = true;
  save.disabled = true;
  try {
    guide = await readStyleGuideFile(file);
    showGuide();
    status.textContent = '文体規範を読み込みました。「保存する」で反映します';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'ファイルを読み込めませんでした';
  } finally {
    guideFile.value = '';
    readingGuide = false;
    guideFields.disabled = false;
    save.disabled = false;
  }
});
clearGuide.addEventListener('click', () => {
  guide = null;
  showGuide();
  status.textContent = '「保存する」で文体規範を解除します';
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || readingGuide) return;
  const selectedMode = mode();
  const selectedProvider = providerForModel(model.value.trim());
  if (selectedMode === 'byok' && !selectedProvider) {
    model.setCustomValidity('候補からモデルを選ぶか、Claude・GPT・DeepSeekのモデルIDを入力してください');
    model.reportValidity();
    return;
  }
  saving = true;
  save.disabled = true;
  guideFields.disabled = true;
  for (const radio of radios) radio.disabled = true;
  showMode();
  try {
    if (selectedMode === 'byok' && selectedProvider) {
      stash();
      await Promise.all([...dirtyProviders].flatMap((changed) => {
        const settings = PROVIDER_SETTINGS[changed];
        const draft = drafts[changed];
        return [settings.key.setValue(draft.key.trim()), settings.model.setValue(draft.model.trim())];
      }));
      await providerItem.setValue(selectedProvider);
      dirtyProviders.clear();
    }
    await reviewModeItem.setValue(selectedMode);
    await styleGuideItem.setValue(guide);
    status.textContent = '保存しました';
  } catch {
    status.textContent = '保存できませんでした。もう一度お試しください。';
  } finally {
    saving = false;
    save.disabled = false;
    guideFields.disabled = false;
    for (const radio of radios) radio.disabled = false;
    showMode();
  }
});
