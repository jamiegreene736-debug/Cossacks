// World-country catalogue used by the civic park system. The scope is the
// United Nations' 193 member states plus its two permanent observer states.
// Factions remain authored gameplay kits; choosing a country changes the
// World Park identity and regional visual without pretending 195 nations all
// share one military history.

const COUNTRY_ROWS = [
  ['AF', 'Afghanistan'], ['AL', 'Albania'], ['DZ', 'Algeria'], ['AD', 'Andorra'],
  ['AO', 'Angola'], ['AG', 'Antigua and Barbuda'], ['AR', 'Argentina'], ['AM', 'Armenia'],
  ['AU', 'Australia'], ['AT', 'Austria'], ['AZ', 'Azerbaijan'], ['BS', 'Bahamas'],
  ['BH', 'Bahrain'], ['BD', 'Bangladesh'], ['BB', 'Barbados'], ['BY', 'Belarus'],
  ['BE', 'Belgium'], ['BZ', 'Belize'], ['BJ', 'Benin'], ['BT', 'Bhutan'],
  ['BO', 'Bolivia'], ['BA', 'Bosnia and Herzegovina'], ['BW', 'Botswana'], ['BR', 'Brazil'],
  ['BN', 'Brunei'], ['BG', 'Bulgaria'], ['BF', 'Burkina Faso'], ['BI', 'Burundi'],
  ['CV', 'Cabo Verde'], ['KH', 'Cambodia'], ['CM', 'Cameroon'], ['CA', 'Canada'],
  ['CF', 'Central African Republic'], ['TD', 'Chad'], ['CL', 'Chile'], ['CN', 'China'],
  ['CO', 'Colombia'], ['KM', 'Comoros'], ['CG', 'Congo'],
  ['CD', 'Democratic Republic of the Congo'], ['CR', 'Costa Rica'],
  ['CI', "Cote d'Ivoire"], ['HR', 'Croatia'], ['CU', 'Cuba'], ['CY', 'Cyprus'],
  ['CZ', 'Czechia'], ['DK', 'Denmark'], ['DJ', 'Djibouti'], ['DM', 'Dominica'],
  ['DO', 'Dominican Republic'], ['EC', 'Ecuador'], ['EG', 'Egypt'], ['SV', 'El Salvador'],
  ['GQ', 'Equatorial Guinea'], ['ER', 'Eritrea'], ['EE', 'Estonia'], ['SZ', 'Eswatini'],
  ['ET', 'Ethiopia'], ['FJ', 'Fiji'], ['FI', 'Finland'], ['FR', 'France'],
  ['GA', 'Gabon'], ['GM', 'Gambia'], ['GE', 'Georgia'], ['DE', 'Germany'],
  ['GH', 'Ghana'], ['GR', 'Greece'], ['GD', 'Grenada'], ['GT', 'Guatemala'],
  ['GN', 'Guinea'], ['GW', 'Guinea-Bissau'], ['GY', 'Guyana'], ['HT', 'Haiti'],
  ['HN', 'Honduras'], ['HU', 'Hungary'], ['IS', 'Iceland'], ['IN', 'India'],
  ['ID', 'Indonesia'], ['IR', 'Iran'], ['IQ', 'Iraq'], ['IE', 'Ireland'],
  ['IL', 'Israel'], ['IT', 'Italy'], ['JM', 'Jamaica'], ['JP', 'Japan'],
  ['JO', 'Jordan'], ['KZ', 'Kazakhstan'], ['KE', 'Kenya'], ['KI', 'Kiribati'],
  ['KP', 'North Korea'], ['KR', 'South Korea'], ['KW', 'Kuwait'], ['KG', 'Kyrgyzstan'],
  ['LA', 'Laos'], ['LV', 'Latvia'], ['LB', 'Lebanon'], ['LS', 'Lesotho'],
  ['LR', 'Liberia'], ['LY', 'Libya'], ['LI', 'Liechtenstein'], ['LT', 'Lithuania'],
  ['LU', 'Luxembourg'], ['MG', 'Madagascar'], ['MW', 'Malawi'], ['MY', 'Malaysia'],
  ['MV', 'Maldives'], ['ML', 'Mali'], ['MT', 'Malta'], ['MH', 'Marshall Islands'],
  ['MR', 'Mauritania'], ['MU', 'Mauritius'], ['MX', 'Mexico'], ['FM', 'Micronesia'],
  ['MD', 'Moldova'], ['MC', 'Monaco'], ['MN', 'Mongolia'], ['ME', 'Montenegro'],
  ['MA', 'Morocco'], ['MZ', 'Mozambique'], ['MM', 'Myanmar'], ['NA', 'Namibia'],
  ['NR', 'Nauru'], ['NP', 'Nepal'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'],
  ['NI', 'Nicaragua'], ['NE', 'Niger'], ['NG', 'Nigeria'], ['MK', 'North Macedonia'],
  ['NO', 'Norway'], ['OM', 'Oman'], ['PK', 'Pakistan'], ['PW', 'Palau'],
  ['PA', 'Panama'], ['PG', 'Papua New Guinea'], ['PY', 'Paraguay'], ['PE', 'Peru'],
  ['PH', 'Philippines'], ['PL', 'Poland'], ['PT', 'Portugal'], ['QA', 'Qatar'],
  ['RO', 'Romania'], ['RU', 'Russia'], ['RW', 'Rwanda'], ['KN', 'Saint Kitts and Nevis'],
  ['LC', 'Saint Lucia'], ['VC', 'Saint Vincent and the Grenadines'], ['WS', 'Samoa'],
  ['SM', 'San Marino'], ['ST', 'Sao Tome and Principe'], ['SA', 'Saudi Arabia'],
  ['SN', 'Senegal'], ['RS', 'Serbia'], ['SC', 'Seychelles'], ['SL', 'Sierra Leone'],
  ['SG', 'Singapore'], ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['SB', 'Solomon Islands'],
  ['SO', 'Somalia'], ['ZA', 'South Africa'], ['SS', 'South Sudan'], ['ES', 'Spain'],
  ['LK', 'Sri Lanka'], ['SD', 'Sudan'], ['SR', 'Suriname'], ['SE', 'Sweden'],
  ['CH', 'Switzerland'], ['SY', 'Syria'], ['TJ', 'Tajikistan'], ['TZ', 'Tanzania'],
  ['TH', 'Thailand'], ['TL', 'Timor-Leste'], ['TG', 'Togo'], ['TO', 'Tonga'],
  ['TT', 'Trinidad and Tobago'], ['TN', 'Tunisia'], ['TR', 'Turkiye'],
  ['TM', 'Turkmenistan'], ['TV', 'Tuvalu'], ['UG', 'Uganda'], ['UA', 'Ukraine'],
  ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States'],
  ['UY', 'Uruguay'], ['UZ', 'Uzbekistan'], ['VU', 'Vanuatu'], ['VE', 'Venezuela'],
  ['VN', 'Vietnam'], ['YE', 'Yemen'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'],
  ['VA', 'Holy See'], ['PS', 'State of Palestine'],
];

export const WORLD_COUNTRIES = Object.freeze(COUNTRY_ROWS.map(([code, name]) => Object.freeze({
  code,
  name,
})));

export const WORLD_COUNTRY_BY_CODE = Object.freeze(Object.fromEntries(
  WORLD_COUNTRIES.map(country => [country.code, country]),
));

export function normalizeWorldCountry(code, fallback = 'GB') {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return WORLD_COUNTRY_BY_CODE[normalized]?.code || fallback;
}

export function countryFlag(code) {
  const normalized = normalizeWorldCountry(code);
  return String.fromCodePoint(...[...normalized].map(letter => 127397 + letter.charCodeAt(0)));
}

const EAST_ASIAN_PARK_COUNTRIES = new Set([
  'BN', 'CN', 'ID', 'JP', 'KH', 'KP', 'KR', 'LA', 'MM', 'MN', 'MY', 'PH', 'SG', 'TH', 'TL', 'VN',
]);
const TROPICAL_PARK_COUNTRIES = new Set([
  'AG', 'BB', 'BS', 'BZ', 'BR', 'CD', 'CG', 'CO', 'CR', 'CU', 'DM', 'DO', 'EC', 'FJ', 'GD', 'GH',
  'GY', 'HT', 'JM', 'KI', 'KM', 'LC', 'MG', 'MH', 'MU', 'MV', 'NG', 'NR', 'PA', 'PG', 'PW', 'SB',
  'SC', 'SR', 'ST', 'TO', 'TT', 'TV', 'VC', 'VU', 'WS',
]);
const OASIS_PARK_COUNTRIES = new Set([
  'AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'ER', 'ET', 'IL', 'IQ', 'IR', 'JO', 'KW', 'LY', 'MA', 'ML',
  'MR', 'NE', 'OM', 'PK', 'PS', 'QA', 'SA', 'SD', 'SO', 'SY', 'TD', 'TN', 'TM', 'YE',
]);
const ALPINE_PARK_COUNTRIES = new Set([
  'AD', 'AM', 'AT', 'BT', 'CH', 'GE', 'IS', 'KG', 'LI', 'NP', 'NO', 'NZ', 'SE', 'TJ',
]);

export function countryParkVariant(code, variantCount = 5) {
  const normalized = normalizeWorldCountry(code);
  if (variantCount === 5) {
    if (EAST_ASIAN_PARK_COUNTRIES.has(normalized)) return 1;
    if (TROPICAL_PARK_COUNTRIES.has(normalized)) return 2;
    if (OASIS_PARK_COUNTRIES.has(normalized)) return 3;
    if (ALPINE_PARK_COUNTRIES.has(normalized)) return 4;
    return 0;
  }
  const hash = normalized.charCodeAt(0) * 31 + normalized.charCodeAt(1);
  return Math.abs(hash) % Math.max(1, variantCount);
}
