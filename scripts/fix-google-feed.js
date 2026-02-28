#!/usr/bin/env node
/* scripts/fix-google-feed.js
   Fetches Samsung KZ Google Shopping feed and applies fixes:
     1. mobile_link → copy of link (not /kz homepage)
     2. google_product_category → official Google taxonomy
     3. S26 links → buy page with modelCode

   Usage:
     GOOGLE_FEED_URL=... node scripts/fix-google-feed.js > public/google-shopping.xml
     node scripts/fix-google-feed.js "https://shop.samsung.com/kz_ru/googleShoppingFeed" > out.xml
*/

const fetch = require('node-fetch');
const xml2js = require('xml2js');

const FEED_URL = process.argv[2] || process.env.GOOGLE_FEED_URL;
if (!FEED_URL) {
  console.error('Usage: GOOGLE_FEED_URL=<url> node scripts/fix-google-feed.js');
  process.exit(2);
}

// ── Category mapping ────────────────────────────────────────────────
// Maps Samsung internal categories to Google taxonomy
// Full taxonomy: https://support.google.com/merchants/answer/6324436
const CATEGORY_MAP = {
  'galaxy s':  'Electronics > Communications > Telephony > Mobile Phones',
  'galaxy z':  'Electronics > Communications > Telephony > Mobile Phones',
  'galaxy a':  'Electronics > Communications > Telephony > Mobile Phones',
  'galaxy tab': 'Electronics > Computers > Tablet Computers',
  'galaxy buds': 'Electronics > Audio > Headphones & Earbuds',
  'galaxy watch': 'Electronics > Electronics Accessories > Smartwatches',
};

function fixCategory(rawCategory) {
  if (!rawCategory) return rawCategory;
  const lower = rawCategory.toLowerCase();
  for (const [pattern, googleCat] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(pattern)) return googleCat;
  }
  // Default: keep smartphones for anything under "Смартфоны"
  if (lower.includes('смартфон') || lower.includes('smartphone')) {
    return 'Electronics > Communications > Telephony > Mobile Phones';
  }
  return rawCategory;
}

// ── S26 link rewriting ──────────────────────────────────────────────
// SM-S948* → Galaxy S26 Ultra
// SM-S947* → Galaxy S26+
// SM-S942* → Galaxy S26
const S26_MODELS = {
  'SM-S948': 'galaxy-s26-ultra',
  'SM-S947': 'galaxy-s26',       // S26+ uses the same /galaxy-s26/ path
  'SM-S942': 'galaxy-s26',
};

function makeBuyLink(productId) {
  if (!productId) return null;
  const prefix = productId.substring(0, 7); // e.g. SM-S948
  const model = S26_MODELS[prefix];
  if (!model) return null;
  return `https://www.samsung.com/kz_ru/smartphones/${model}/buy/?modelCode=${productId}`;
}

// ── XML helpers ─────────────────────────────────────────────────────
function getTagValue(entry, ns, tag) {
  // Try namespaced first, then bare
  const candidates = [
    entry[`${ns}:${tag}`],
    entry[tag],
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (Array.isArray(c)) return c[0];
    if (typeof c === 'object' && c._ != null) return c._;
    if (typeof c === 'object' && c.$ != null) return c.$.href || '';
    return String(c);
  }
  return null;
}

function setTagValue(entry, ns, tag, value) {
  const key = `${ns}:${tag}`;
  if (entry[key] != null) {
    if (Array.isArray(entry[key])) entry[key] = [value];
    else entry[key] = value;
  } else if (entry[tag] != null) {
    if (Array.isArray(entry[tag])) entry[tag] = [value];
    else entry[tag] = value;
  } else {
    entry[key] = value;
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.error(`Fetching feed from: ${FEED_URL}`);
  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': 'Samsung-Feed-Fix/1.0' },
    timeout: 60000,
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  console.error(`Feed size: ${xml.length} bytes`);

  // Parse preserving namespaces
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: false,
    xmlns: false,
    tagNameProcessors: [],
  });
  const root = await parser.parseStringPromise(xml);

  // Navigate to entries
  const feed = root.feed || root;
  let entries = feed.entry;
  if (!entries) {
    console.error('No entries found in feed');
    process.exit(1);
  }
  if (!Array.isArray(entries)) entries = [entries];

  let fixedMobile = 0, fixedCategory = 0, fixedS26Links = 0;

  for (const entry of entries) {
    // 1. Get the product ID
    const id = getTagValue(entry, 'g', 'id') || '';

    // 2. Get the main link
    const link = getTagValue(entry, 'g', 'link') || '';

    // 3. Fix mobile_link: copy from link
    const mobileLink = getTagValue(entry, 'g', 'mobile_link');
    if (mobileLink != null) {
      // If mobile_link is homepage or different from link, replace it
      const isHomepage = /samsung\.com\/kz\/?$/i.test(mobileLink) || 
                         /samsung\.com\/kz_ru\/?$/i.test(mobileLink);
      const isDifferent = mobileLink !== link;
      if (isHomepage || isDifferent) {
        setTagValue(entry, 'g', 'mobile_link', link);
        fixedMobile++;
      }
    }

    // 4. Fix google_product_category
    const category = getTagValue(entry, 'g', 'google_product_category');
    if (category) {
      const fixed = fixCategory(category);
      if (fixed !== category) {
        setTagValue(entry, 'g', 'google_product_category', fixed);
        fixedCategory++;
      }
    }

    // 5. Fix S26 links to buying page
    const buyLink = makeBuyLink(id);
    if (buyLink && link !== buyLink) {
      setTagValue(entry, 'g', 'link', buyLink);
      // Also update mobile_link to match
      setTagValue(entry, 'g', 'mobile_link', buyLink);
      fixedS26Links++;
    }
  }

  console.error(`\n── Results ──`);
  console.error(`Total entries: ${entries.length}`);
  console.error(`Fixed mobile_link: ${fixedMobile}`);
  console.error(`Fixed google_product_category: ${fixedCategory}`);
  console.error(`Fixed S26 buy links: ${fixedS26Links}`);

  // Rebuild XML
  const builder = new xml2js.Builder({
    xmldec: { version: '1.0', encoding: 'utf-8' },
    renderOpts: { pretty: true, indent: '  ', newline: '\n' },
  });
  const outputXml = builder.buildObject(root);
  process.stdout.write(outputXml);

  console.error(`\nOutput size: ${outputXml.length} bytes`);
  console.error('Done!');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
