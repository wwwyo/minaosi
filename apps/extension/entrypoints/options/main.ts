import { isReviewProvider, type ReviewMode, type ReviewProvider } from '../minaosi/review/providers';
import { reviewModeItem, providerItem, PROVIDER_SETTINGS } from '../minaosi/store';
import { providerForModel } from '../minaosi/review/models';
import { PANEL_CSS } from '../minaosi/ui/styles';
import { BRAND_LOCKUP } from '../minaosi/ui/brand';
import './style.css';

const style = document.createElement('style');
style.textContent = PANEL_CSS;
document.head.prepend(style);
document.querySelector('#brand')!.innerHTML = BRAND_LOCKUP;
const form = document.querySelector<HTMLFormElement>('#settings')!;
const fields = document.querySelector<HTMLFieldSetElement>('#byok-fields')!;
const model = document.querySelector<HTMLInputElement>('#model')!;
const key = document.querySelector<HTMLInputElement>('#api-key')!;
const status = document.querySelector<HTMLElement>('#status')!;
const save = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
const radios = [...form.querySelectorAll<HTMLInputElement>('[name="mode"]')];
const drafts: Record<ReviewProvider, { key: string; model: string }> = {
  anthropic: { key: '', model: 'claude-sonnet-5' },
  openai: { key: '', model: 'gpt-5.4-mini' },
  deepseek: { key: '', model: 'deepseek-flash' },
  'opencode-go': { key: '', model: 'space-bunny-free' },
};
let provider: ReviewProvider = 'anthropic';
let saving = false;
const dirtyProviders = new Set<ReviewProvider>();
const mode = (): ReviewMode => radios.find((radio) => radio.checked)?.value === 'byok' ? 'byok' : 'default';
function showMode() {
  fields.hidden = mode() !== 'byok';
  fields.disabled = fields.hidden || saving;
}
function stash() { drafts[provider] = { key: key.value, model: model.value }; dirtyProviders.add(provider); }
function loadDraft() { key.value = drafts[provider].key; model.value = drafts[provider].model; }

try {
  const [savedMode, savedProvider, anthropicKey, anthropicModel, openaiKey, openaiModel, deepseekKey, deepseekModel, opencodeKey, opencodeModel] = await Promise.all([
    reviewModeItem.getValue(), providerItem.getValue(), PROVIDER_SETTINGS.anthropic.key.getValue(),
    PROVIDER_SETTINGS.anthropic.model.getValue(), PROVIDER_SETTINGS.openai.key.getValue(), PROVIDER_SETTINGS.openai.model.getValue(),
    PROVIDER_SETTINGS.deepseek.key.getValue(), PROVIDER_SETTINGS.deepseek.model.getValue(),
    PROVIDER_SETTINGS['opencode-go'].key.getValue(), PROVIDER_SETTINGS['opencode-go'].model.getValue(),
  ]);
  provider = isReviewProvider(savedProvider) ? savedProvider : 'anthropic';
  drafts.anthropic = { key: anthropicKey, model: anthropicModel || 'claude-sonnet-5' };
  drafts.openai = { key: openaiKey, model: openaiModel || 'gpt-5.4-mini' };
  drafts.deepseek = { key: deepseekKey, model: deepseekModel || 'deepseek-flash' };
  drafts['opencode-go'] = { key: opencodeKey, model: opencodeModel || 'space-bunny-free' };
  loadDraft();
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
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  const selectedMode = mode();
  const selectedProvider = providerForModel(model.value.trim());
  if (selectedMode === 'byok' && !selectedProvider) {
    model.setCustomValidity('候補からモデルを選ぶか、Claude・GPT・DeepSeekのモデルIDを入力してください');
    model.reportValidity();
    return;
  }
  saving = true;
  save.disabled = true;
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
    status.textContent = '保存しました';
  } catch {
    status.textContent = '保存できませんでした。もう一度お試しください。';
  } finally {
    saving = false;
    save.disabled = false;
    for (const radio of radios) radio.disabled = false;
    showMode();
  }
});
