import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_ENDONYMS, countryEndonym } from '../src/countries.ts';
import { setLanguage } from '../src/i18n.ts';

/** The endonym table as approved for R3.3.1 — the spec is the source of truth. */
const APPROVED: Record<string, string> = {
  russia: 'Россия',
  finland: 'Suomi',
  estonia: 'Eesti',
  'united-kingdom': 'United Kingdom',
  romania: 'România',
  greece: 'Ελλάδα',
  latvia: 'Latvija',
};

test('the endonym reference holds exactly the approved native names', () => {
  assert.deepEqual(Object.keys(COUNTRY_ENDONYMS).sort(), Object.keys(APPROVED).sort());
  for (const [id, name] of Object.entries(APPROVED)) {
    assert.equal(countryEndonym(id), name, `${id} must render its endonym`);
    assert.ok(name.trim().length > 0, `${id} needs a non-empty endonym`);
  }
});

test('endonyms do not follow the UI language', () => {
  // The function takes no language argument by design; switching the dictionary
  // must therefore leave every country name byte-identical (check 4 of R3.3.1).
  setLanguage('ru');
  const underRussian = countryEndonym('finland');
  const russianScope = countryEndonym('russia');
  setLanguage('fi');
  assert.equal(countryEndonym('finland'), underRussian);
  assert.equal(countryEndonym('russia'), russianScope);
  assert.equal(underRussian, 'Suomi');
  assert.equal(russianScope, 'Россия');
  setLanguage('en');
});

test('an unknown country id degrades to the catalogue name, never to a translation', () => {
  assert.equal(countryEndonym('france', 'Франция'), 'Франция');
  assert.equal(countryEndonym('france', null), 'france');
  assert.equal(countryEndonym('france'), 'france');
});
