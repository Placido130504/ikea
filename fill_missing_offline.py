import json
from pathlib import Path
import re

# Offline dimension extraction - no network needed
def extract_dimensions_reliable(text):
    """Extract clean dimensions from text using multiple strategies"""
    if not text:
        return "N/A"
    
    # Strategy 1: Look for standard dimension patterns (e.g., 39x30 cm, 90x200x50 cm)
    patterns = [
        r'(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*cm',  # 3D
        r'(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*cm',  # 2D
        r'W\s*(\d+(?:\.\d+)?)\s*x\s*D\s*(\d+(?:\.\d+)?)\s*x\s*H\s*(\d+(?:\.\d+)?)\s*cm',  # W x D x H
        r'Length\s*(\d+(?:\.\d+)?)\s*x\s*Width\s*(\d+(?:\.\d+)?)\s*x\s*Height\s*(\d+(?:\.\d+)?)\s*cm',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            groups = match.groups()
            if len(groups) == 3 and groups[2]:
                return f"{groups[0]}x{groups[1]}x{groups[2]}cm"
            elif len(groups) >= 2:
                return f"{groups[0]}x{groups[1]}cm"
    
    return "N/A"


def fill_missing_dimensions_offline():
    """Fill missing Dimensions using ONLY offline parsing (no network)"""
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
        print(f'Processing {file.name}...')
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
                
                # Try offline extraction on raw text
                current = p.get('Dimensions') or p.get('dimension') or p.get('Dimension') or ''
                extracted = extract_dimensions_reliable(current)

                if extracted and extracted != 'N/A':
                    p['Dimensions'] = extracted
                    changed += 1
                    print(f'    [{idx}] {product_name:<30} -> {extracted}')
                else:
                    # Try extracting from product name
                    name_extracted = extract_dimensions_reliable(p.get('Product Name', ''))
                    if name_extracted and name_extracted != 'N/A':
                        p['Dimensions'] = name_extracted
                        changed += 1
                        print(f'    [{idx}] {product_name:<30} (from name) -> {name_extracted}')

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
    print(f'Total filled (offline): {total_filled}')
    print(f'Still missing: {total_missing - total_filled}')


if __name__ == '__main__':
    fill_missing_dimensions_offline()
