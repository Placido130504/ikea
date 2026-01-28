import argparse
import json
import os
import re
import time
from pathlib import Path

# optional import for dimension scraping
try:
    from dimensions import scrape_dimensions
except Exception:
    scrape_dimensions = None

def clean_text(text):
    """Remove [U+200E] and other unwanted characters"""
    if isinstance(text, str):
        # Remove U+200E (right-to-left mark) and other invisible Unicode characters
        text = text.replace('\u200e', '')
        text = text.replace('\u200f', '')
        text = text.replace('\u202a', '')
        text = text.replace('\u202b', '')
        text = text.replace('\u202c', '')
        text = text.replace('\u202d', '')
        text = text.replace('\u202e', '')
        text = text.strip()
    return text

def extract_subtype_from_filename(filename):
    """Extract subtype from filename (e.g., 'bed' from 'bed.json')"""
    name = filename.replace('.json', '')
    return name

def get_type_from_subtype(subtype):
    """Map subtype to type based on categorization"""
    type_mapping = {
        # Table types
        'dining_table': 'Table',
        'dining table': 'Table',
        'study_table': 'Table',
        'study table': 'Table',
        'casual_table': 'Table',
        'casual table': 'Table',
        'tea_table': 'Table',
        'tea table': 'Table',
        
        # Chair types
        'dining_chair': 'Chair',
        'dining chair': 'Chair',
        'casual_chair': 'Chair',
        'casual chair': 'Chair',
        'gaming_chair': 'Chair',
        'gaming chair': 'Chair',
        'office_chair': 'Chair',
        'rocking_chair': 'Chair',
        'rocking chair': 'Chair',
        
        # Bed types
        'bed': 'Bed',
        
        # Sofa types
        'sofa': 'Sofa',
        
        # Storage types
        'storage': 'Storage',
        'shelves': 'Storage',
        'shelves_output': 'Storage',
        'wardrobe': 'Storage',
        'cupboard': 'Storage',
        'cabinet': 'Storage',
        'cabinets': 'Storage',
    }
    
    return type_mapping.get(subtype, '')


def clean_dimension(text):
    """Extract and normalize dimension like '90x55 cm' -> '90x55cm' or '35 cm' -> '35cm'."""
    if not isinstance(text, str) or not text:
        return ''

    # remove invisible characters and trim
    text = clean_text(text)

    # Look for patterns like: 90x55 cm, 53x43x69 cm, 75 cm
    m = re.search(r'(\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?){0,2}\s*cm)', text, re.IGNORECASE)
    if m:
        dim = m.group(1)
        dim = re.sub(r'\s*x\s*', 'x', dim)
        dim = re.sub(r'\s*cm', 'cm', dim, flags=re.IGNORECASE)
        return dim

    return ''

def process_output_files(input_path=None):
    """Process `output.json` (if present) or fall back to existing split_output behavior.

    Returns a list of normalized product dicts.
    """
    base_dir = Path(__file__).parent
    combined_products = []
    product_id_counter = 1

    # prefer explicit input file, else look for root output.json
    if input_path is None:
        candidate = base_dir / 'output.json'
    else:
        candidate = Path(input_path)

    if candidate.exists():
        print(f"Processing single file: {candidate.name}")
        try:
            with open(candidate, 'r', encoding='utf-8') as f:
                data = json.load(f)

            products = data.get('products', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])

            for product in products:
                product_name = clean_text(product.get('Product Name', '') or product.get('name', '') or product.get('Name', ''))
                if not product_name:
                    continue

                raw_dim = product.get('Dimensions', '') or product.get('dimension', '') or product.get('Dimension', '')
                cleaned_dim = clean_dimension(raw_dim)

                processed_product = {
                    'ID': f'I-{product_id_counter:04d}',
                    'Name': product_name,
                    'Dimension': cleaned_dim,
                    'Price': product.get('Price', '') or product.get('price', ''),
                    'Type': '',
                    'SubType': '',
                    'Brand': 'IKEA',
                    'ProductURL': clean_text(product.get('Product URL', '') or product.get('ProductURL', '') or product.get('url', ''))
                }

                combined_products.append(processed_product)
                product_id_counter += 1

        except json.JSONDecodeError as e:
            print(f"Error processing {candidate.name}: {e}")
        except Exception as e:
            print(f"Unexpected error processing {candidate.name}: {e}")

        return combined_products

    # fallback: existing split_output behavior
    output_dir = base_dir / 'split_output'
    json_files = sorted([f for f in output_dir.glob('*.json') if 'combined' not in f.name])
    print(f"Found {len(json_files)} files to process in split_output")

    for json_file in json_files:
        subtype = extract_subtype_from_filename(json_file.name)
        print(f"Processing: {json_file.name} (subtype: {subtype})")

        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            products = data if isinstance(data, list) else data.get('products', [])

            for product in products:
                product_name = clean_text(product.get('name', '') or product.get('Name', '') or product.get('Product Name', ''))
                if not product_name:
                    continue

                raw_dim = product.get('dimension', '') or product.get('Dimension', '')
                cleaned_dim = clean_dimension(raw_dim)

                processed_product = {
                    'ID': f'I-{product_id_counter:04d}',
                    'Name': product_name,
                    'Dimension': cleaned_dim,
                    'Price': product.get('price', '') or product.get('Price', ''),
                    'Type': get_type_from_subtype(subtype),
                    'SubType': subtype,
                    'Brand': 'IKEA',
                    'ProductURL': clean_text(product.get('url', '') or product.get('ProductURL', '') or product.get('Product URL', ''))
                }

                combined_products.append(processed_product)
                product_id_counter += 1

        except json.JSONDecodeError as e:
            print(f"Error processing {json_file.name}: {e}")
        except Exception as e:
            print(f"Unexpected error processing {json_file.name}: {e}")

    return combined_products


def combine_split_output_files(enrich_missing=True, batch_size=0, out_base='ikea_Jan'):
    """Combine all files in `split_output`, preserve SubType/Type, and enrich missing dimensions.

    If `enrich_missing` is True and `dimensions.scrape_dimensions` is available, the function will
    attempt to fetch dimensions from product pages for items missing a clean dimension.
    """
    base_dir = Path(__file__).parent
    output_dir = base_dir / 'split_output'
    combined_products = []
    product_id_counter = 1

    json_files = sorted([f for f in output_dir.glob('*.json') if 'combined' not in f.name])
    print(f"Found {len(json_files)} files to combine from split_output")

    for json_file in json_files:
        subtype = extract_subtype_from_filename(json_file.name)
        type_name = get_type_from_subtype(subtype)

        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            products = data if isinstance(data, list) else data.get('products', [])

            for product in products:
                product_name = clean_text(product.get('Product Name', '') or product.get('name', '') or product.get('Name', ''))
                if not product_name:
                    continue

                raw_dim = product.get('Dimensions', '') or product.get('dimension', '') or product.get('Dimension', '')
                cleaned_dim = clean_dimension(raw_dim)

                # If no clean dimension and enrichment requested, try scraping
                if not cleaned_dim and enrich_missing and scrape_dimensions and product.get('Product URL'):
                    try:
                        scraped = scrape_dimensions(product.get('Product URL'))
                        cleaned_dim = clean_dimension(scraped)
                        # be gentle
                        time.sleep(0.15)
                    except Exception:
                        cleaned_dim = ''

                processed_product = {
                    'ID': f'I-{product_id_counter:04d}',
                    'Name': product_name,
                    'Dimension': cleaned_dim,
                    'Price': product.get('Price', '') or product.get('price', ''),
                    'Type': type_name,
                    'SubType': subtype,
                    'Brand': 'IKEA',
                    'ProductURL': clean_text(product.get('Product URL', '') or product.get('ProductURL', '') or product.get('url', ''))
                }

                combined_products.append(processed_product)
                product_id_counter += 1

                # Periodically save progress so long runs are resumable
                if batch_size and product_id_counter % batch_size == 0:
                    save_combined_output(combined_products, base_name=f"{out_base}_partial")

        except json.JSONDecodeError as e:
            print(f"Error processing {json_file.name}: {e}")
        except Exception as e:
            print(f"Unexpected error processing {json_file.name}: {e}")

    return combined_products

def save_combined_output(products, base_name='ikea_combined'):
    """Save combined products to a single JSON file with given base name in repo root."""
    output_file = Path(__file__).parent / f'{base_name}.json'

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(products, f, indent=2, ensure_ascii=False)

    print(f"\nCombined {len(products)} products")
    print(f"Product IDs: I-0001 to I-{len(products):04d}")
    print(f"Saved to: {output_file}")

def save_csv_output(products, base_name='ikea_combined'):
    """Save combined products to CSV for easier viewing"""
    import csv
    output_file = Path(__file__).parent / f'{base_name}.csv'

    if not products:
        print("No products to save")
        return

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['ID', 'Name', 'Dimension', 'Price', 'Type', 'SubType', 'Brand', 'ProductURL']
        writer = csv.DictWriter(f, fieldnames=fieldnames)

        writer.writeheader()
        writer.writerows(products)

    print(f"CSV saved to: {output_file}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Finish and combine IKEA product outputs')
    parser.add_argument('--split', action='store_true', help='Combine files from split_output (use subtypes)')
    parser.add_argument('--no-enrich', action='store_true', help='Do not scrape product pages for missing dimensions')
    parser.add_argument('--out', type=str, default='ikea_Jan', help='Base name for output files')
    parser.add_argument('--batch-size', type=int, default=0, help='Save progress every N products when scraping')

    args = parser.parse_args()

    print("Starting IKEA product finisher...\n")

    if args.split:
        combined_products = combine_split_output_files(enrich_missing=not args.no_enrich, batch_size=args.batch_size, out_base=args.out)
    else:
        combined_products = process_output_files()

    save_combined_output(combined_products, base_name=args.out)
    save_csv_output(combined_products, base_name=args.out)

    print("\nFinisher completed!")
