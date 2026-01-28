import json
import time
from pathlib import Path

from dimensions import extract_dimensions_reliable, scrape_dimensions


def fill_missing_dimensions(enrich_scrape=True, delay=0.2):
    """Fill missing Dimensions only for products that have null/empty Dimension fields"""
    root = Path(__file__).parent
    out_dir = root / 'split_output'
    files = sorted([p for p in out_dir.glob('*.json') if 'combined' not in p.name])

    if not files:
        print('No files found in split_output')
        return

    print(f'Found {len(files)} files to process\n')

    total_missing = 0
    total_filled = 0

    for file in files:
        print(f'Scanning {file.name}...')
        try:
            with open(file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            products = data.get('products', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            
            missing_products = []
            for idx, p in enumerate(products):
                dim = p.get('Dimensions') or p.get('dimension') or p.get('Dimension') or ''
                if not dim or dim.strip() == 'N/A':
                    missing_products.append((idx, p))
            
            if not missing_products:
                print(f'  No missing dimensions found\n')
                continue

            print(f'  Found {len(missing_products)} products with missing dimensions')
            changed = 0

            for idx, p in missing_products:
                product_name = p.get('Product Name', 'Unknown')[:30]
                
                # Try reliable extractor first (offline)
                current = p.get('Dimensions') or p.get('dimension') or p.get('Dimension') or ''
                extracted = extract_dimensions_reliable(current)

                if extracted and extracted != 'N/A':
                    p['Dimensions'] = extracted
                    changed += 1
                    print(f'    [{idx}] {product_name:<30} [EXTRACTED] {extracted}')
                    continue

                # Fallback: try scraping if allowed and url present
                url = p.get('Product URL') or p.get('ProductURL') or p.get('url')
                if enrich_scrape and url:
                    try:
                        scraped = scrape_dimensions(url)
                        if scraped and scraped != 'N/A':
                            p['Dimensions'] = scraped
                            changed += 1
                            print(f'    [{idx}] {product_name:<30} [SCRAPED] {scraped}')
                        else:
                            print(f'    [{idx}] {product_name:<30} [FAILED]')
                    except Exception as e:
                        print(f'    [{idx}] {product_name:<30} [ERROR] {str(e)[:30]}')
                    time.sleep(delay)
                else:
                    print(f'    [{idx}] {product_name:<30} [SKIPPED]')

            # Write back to same file
            with open(file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            total_missing += len(missing_products)
            total_filled += changed
            print(f'  Finished: filled {changed}/{len(missing_products)} dimensions\n')

        except Exception as e:
            print(f'  Error processing {file.name}: {e}\n')

    print(f'=== SUMMARY ===')
    print(f'Total products with missing dimensions: {total_missing}')
    print(f'Total filled: {total_filled}')
    print(f'Success rate: {100 * total_filled / total_missing if total_missing > 0 else 0:.1f}%')


if __name__ == '__main__':
    fill_missing_dimensions(enrich_scrape=True, delay=0.2)
