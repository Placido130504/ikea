import json
from pathlib import Path
from collections import defaultdict

# Define paths
ROOT_DIR = Path(__file__).parent
OUTPUT_FILE = ROOT_DIR / "Ikea-pepperfryScraper" / "data" / "output.json"
INPUT_DIR = ROOT_DIR / "split_inputs"

# Create input directory if it doesn't exist
INPUT_DIR.mkdir(exist_ok=True)

def load_output_data():
    """Load the output.json file"""
    with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def split_by_query(data):
    """Group products by originalQuery"""
    grouped = defaultdict(list)
    
    for result in data.get("results", []):
        query = result.get("originalQuery", "unknown")
        products = result.get("products", [])
        grouped[query].extend(products)
    
    return grouped

def save_split_files(grouped_data):
    """Save each query's products to split_inputs folder"""
    saved_files = []
    
    for query, products in grouped_data.items():
        # Create a safe filename from the query
        safe_filename = "".join(c for c in query if c.isalnum() or c in (' ', '-', '_')).strip()
        input_file = INPUT_DIR / f"{safe_filename}.json"
        
        # Create the input JSON structure
        input_data = {
            "originalQuery": query,
            "products": products
        }
        
        # Write the file
        with open(input_file, "w", encoding="utf-8") as f:
            json.dump(input_data, f, indent=2, ensure_ascii=False)
        
        saved_files.append((safe_filename, len(products)))
        print(f"[OK] Created: {input_file.name} ({len(products)} products)")
    
    return saved_files

def main():
    print("=" * 70)
    print("IKEA Data Splitter - Prepare Input Files")
    print("=" * 70)
    
    try:
        # Load output data
        print("\n[1] Loading output.json...")
        data = load_output_data()
        total_results = len(data.get('results', []))
        total_products = sum(len(r.get('products', [])) for r in data.get('results', []))
        print(f"    Found {total_results} search queries with {total_products} total products")
        
        # Split by query
        print("\n[2] Splitting data by originalQuery...")
        grouped_data = split_by_query(data)
        print(f"    Found {len(grouped_data)} unique queries")
        
        # Save split files
        print("\n[3] Saving split files to split_inputs folder...\n")
        saved_files = save_split_files(grouped_data)
        
        # Summary
        print("\n" + "=" * 70)
        print("SUMMARY")
        print("=" * 70)
        for filename, count in saved_files:
            print(f"  {filename}.json - {count} products")
        
        print("\n" + "=" * 70)
        print(f"[SUCCESS] Created {len(saved_files)} files in split_inputs/")
        print(f"[NEXT] Run: python dimensions.py")
        print("=" * 70)
        
    except Exception as e:
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
