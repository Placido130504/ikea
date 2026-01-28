import json
import time
from pathlib import Path

from dimensions import extract_dimensions_reliable, scrape_dimensions


def process_split_output(enrich_scrape=True, delay=0.15):
    root = Path(__file__).parent
    out_dir = root / 'split_output'
    files = sorted([p for p in out_dir.glob('*.json') if 'combined' not in p.name])

    if not files:
        print('No files found in split_output')
        return

    print(f'Found {len(files)} files to process')

    for file in files:
        print(f'Processing {file.name}...')
        try:
            with open(file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            products = data.get('products', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            changed = 0

            for p in products:
                # current dimension fields may be under 'Dimensions' or 'Dimensions'
                current = p.get('Dimensions') or p.get('dimension') or p.get('Dimension') or ''

                # try reliable extractor first
                extracted = extract_dimensions_reliable(current)

                if extracted and extracted != 'N/A':
                    if p.get('Dimensions') != extracted:
                        p['Dimensions'] = extracted
                        changed += 1
                    continue

                # fallback: try scraping if allowed and url present
                url = p.get('Product URL') or p.get('ProductURL') or p.get('url')
                if enrich_scrape and url:
                    scraped = scrape_dimensions(url)
                    if scraped and scraped != 'N/A':
                        p['Dimensions'] = scraped
                        changed += 1
                    time.sleep(delay)

            # write back to same file
            with open(file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f'Finished {file.name}: updated {changed} products')

        except Exception as e:
            print(f'Error processing {file.name}: {e}')


if __name__ == '__main__':
    process_split_output(enrich_scrape=True, delay=0.2)
