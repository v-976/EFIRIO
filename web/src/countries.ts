/**
 * Country endonyms (R3.3.1).
 *
 * A country is always written the way its own people write it, whatever the
 * UI language: the same stable id renders the same label in every one of the
 * seven languages and on every screen — the category picker, the Internet
 * country selector, the breadcrumb, station-card subtitles and the player's
 * place line. This table is the single place country names are written down:
 * the JSON catalogues keep their original data untouched, and the language
 * dictionaries carry no country-name translations at all.
 *
 * A future country joins by adding its id here; an id that has not been added
 * yet degrades to the display name the catalogue itself carries — it never
 * crashes and never invents a translation.
 */

/** Approved endonyms keyed by the stable country ids used across the catalogues. */
export const COUNTRY_ENDONYMS: Readonly<Record<string, string>> = {
  russia: 'Россия',
  finland: 'Suomi',
  estonia: 'Eesti',
  'united-kingdom': 'United Kingdom',
  romania: 'România',
  greece: 'Ελλάδα',
  latvia: 'Latvija',
  lithuania: 'Lietuva',
  albania: 'Shqipëria',
  kosovo: 'Kosova',
};

/**
 * The endonym for a country id. Deliberately takes no language argument:
 * country names cannot depend on the UI language, so there is nothing to pass.
 * Unknown ids fall back to the catalogue's own display name, then to the id.
 */
export function countryEndonym(id: string, fallback?: string | null): string {
  const endonym: string | undefined = COUNTRY_ENDONYMS[id];
  return endonym ?? fallback ?? id;
}
