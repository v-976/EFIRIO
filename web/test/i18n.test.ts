import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGE_KEY, LANGUAGE_LABELS, SUPPORTED_LANGUAGES, detectLanguage, en, getLanguage,
  initLanguage, isSupportedLanguage, registerLocaleLoaders, setLanguage, subscribeLanguage, translate,
} from '../src/i18n.ts';
import ru from '../src/locales/ru.ts';
import fi from '../src/locales/fi.ts';
import sv from '../src/locales/sv.ts';
import et from '../src/locales/et.ts';
import ro from '../src/locales/ro.ts';
import el from '../src/locales/el.ts';

/** Dictionaries under test; `sv` is deliberately left without a loader to model an unloaded language. */
const dictionaries = { ru, fi, et, ro, el };
registerLocaleLoaders({
  './locales/ru.ts': () => Promise.resolve(ru),
  './locales/fi.ts': () => Promise.resolve(fi),
  './locales/et.ts': () => Promise.resolve(et),
  './locales/ro.ts': () => Promise.resolve(ro),
  './locales/el.ts': () => Promise.resolve(el),
});

const PLACEHOLDER = /\{(\w+)\}/g;
function placeholders(template: string): string[] { return [...template.matchAll(PLACEHOLDER)].map((hit) => hit[1]).sort(); }
/** Lets a fire-and-forget dictionary load settle before asserting translated text. */
function flush(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }

test('detectLanguage maps regional variants to base codes', () => {
  assert.equal(detectLanguage(['fi-FI', 'en-US']), 'fi');
  assert.equal(detectLanguage(['el-GR']), 'el');
  assert.equal(detectLanguage(['et-EE']), 'et');
  assert.equal(detectLanguage(['ro-RO', 'en-GB']), 'ro');
  assert.equal(detectLanguage(['sv-SE']), 'sv');
  assert.equal(detectLanguage(['ru-RU']), 'ru');
});

test('detectLanguage falls back to English for unsupported languages', () => {
  assert.equal(detectLanguage(['de-DE']), 'en');
  assert.equal(detectLanguage(['ja-JP']), 'en');
  assert.equal(detectLanguage(['zh-CN', 'de-DE']), 'en');
  assert.equal(detectLanguage([]), 'en');
});

test('detectLanguage scans the whole preference list, first supported wins', () => {
  assert.equal(detectLanguage(['de-DE', 'sv', 'fi']), 'sv');
});

test('an unloaded dictionary falls back to English per key', () => {
  // `sv` never gets a loader in this suite, so its dictionary is never loaded.
  assert.equal(translate('sv', 'chooseStation'), 'Choose a station');
  assert.equal(translate('sv', 'tagline'), en.tagline);
});

test('translate renders a loaded dictionary and interpolates parameters', async () => {
  setLanguage('ru');
  await flush();
  assert.equal(translate('ru', 'chooseStation'), 'Выберите станцию');
  assert.equal(translate('ru', 'loadingCatalogue', { name: 'Финляндия' }), 'Загрузка каталога Финляндия…');
  assert.equal(translate('ru', 'placeVersion', { place: 'Санкт-Петербург', version: 'Alpha 0.1' }), 'Санкт-Петербург · Alpha 0.1');
});

test('translate never renders a technical key or an empty string', () => {
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    const params: Record<string, string> = {};
    for (const name of placeholders(en[key])) params[name] = 'X';
    const value = translate('en', key, params);
    assert.ok(value.length > 0, `${key} must not be empty`);
    assert.ok(!value.includes('{'), `${key} must not contain an unrendered placeholder: ${value}`);
  }
});

test('every shipped dictionary covers the full English key set with non-empty strings', () => {
  const enKeys = Object.keys(en).sort();
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    const keys = Object.keys(dictionary).sort();
    assert.deepEqual(keys, enKeys, `${code} must cover exactly the English key set`);
    for (const key of enKeys) {
      const value = (dictionary as Record<string, string>)[key];
      assert.ok(value && value.trim().length > 0, `${code}.${key} must be a non-empty string`);
    }
  }
});

test('translated placeholders always match the English template', () => {
  const enKeys = Object.keys(en) as Array<keyof typeof en>;
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    for (const key of enKeys) {
      const value = (dictionary as Record<string, string>)[key];
      assert.deepEqual(placeholders(value), placeholders(en[key]), `${code}.${key} placeholders must match English`);
    }
  }
});

test('the seven supported languages each have an endonym label', () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES].sort(), ['el', 'en', 'et', 'fi', 'ro', 'ru', 'sv']);
  for (const code of SUPPORTED_LANGUAGES) {
    assert.ok(LANGUAGE_LABELS[code].trim().length > 0, `${code} needs an endonym`);
  }
});

test('isSupportedLanguage accepts only shipped codes', () => {
  assert.equal(isSupportedLanguage('et'), true);
  assert.equal(isSupportedLanguage('de'), false);
  assert.equal(isSupportedLanguage(null), false);
});

test('setLanguage persists the manual choice and notifies subscribers', () => {
  const written = new Map<string, string>();
  // Node has no localStorage; a stub lets us assert the persistence contract.
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => written.get(key) ?? null,
    setItem: (key: string, value: string) => { written.set(key, value); },
  };
  let notified = 0;
  const unsubscribe = subscribeLanguage(() => { notified += 1; });
  setLanguage('el');
  assert.equal(getLanguage(), 'el');
  assert.equal(written.get(LANGUAGE_KEY), 'el', 'the manual choice must be stored');
  assert.ok(notified >= 1, 'subscribers must be notified so React re-renders');
  unsubscribe();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('initLanguage prefers a stored manual choice over the browser list', async () => {
  const written = new Map<string, string>([[LANGUAGE_KEY, 'ro']]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => written.get(key) ?? null,
    setItem: (key: string, value: string) => { written.set(key, value); },
  };
  const chosen = await initLanguage(['fi-FI']);
  assert.equal(chosen, 'ro', 'the saved manual choice outranks navigator.languages');
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('initLanguage detects the browser language on first launch', async () => {
  const chosen = await initLanguage(['de-DE', 'et-EE']);
  assert.equal(chosen, 'et');
});

test('registerLocaleLoaders ignores unknown codes and the English bundle', () => {
  // Registration is idempotent and defensive: a stray file must never break boot.
  registerLocaleLoaders({
    './locales/xx.ts': () => Promise.reject(new Error('unknown')),
    './locales/en.ts': () => Promise.resolve(en),
  });
  assert.equal(isSupportedLanguage(getLanguage()), true);
});
