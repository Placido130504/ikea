import json
import requests
from bs4 import BeautifulSoup
from pathlib import Path
import time
import re

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

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
                return f"{groups[0]}x{groups[1]}x{groups[2]} cm"
            elif len(groups) >= 2:
                return f"{groups[0]}x{groups[1]} cm"
    
    return "N/A"

def scrape_dimensions(url):
    """Scrape dimensions from IKEA product page with multiple fallback strategies"""
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        
        # Strategy 1: Look in all text for dimension patterns
        page_text = soup.get_text()
        dimensions = extract_dimensions_reliable(page_text)
        
        if dimensions != "N/A":
            return dimensions
        
        # Strategy 2: Check meta tags
        meta_desc = soup.find("meta", {"name": "description"})
        if meta_desc and meta_desc.get("content"):
            dimensions = extract_dimensions_reliable(meta_desc.get("content"))
            if dimensions != "N/A":
                return dimensions
        
        # Strategy 3: Look in specific product info sections
        info_sections = soup.find_all(["div", "span", "p"], {"class": re.compile("measure|dimension|size|spec", re.I)})
        for section in info_sections[:5]:  # Check first 5 matching sections
            dimensions = extract_dimensions_reliable(section.get_text())
            if dimensions != "N/A":
                return dimensions
        
        # Strategy 4: Check JSON-LD structured data
        json_ld = soup.find("script", {"type": "application/ld+json"})
        if json_ld:
            try:
                data = json.loads(json_ld.string)
                # Look for dimension info in various places
                for key in ["width", "height", "depth", "dimensions", "specs"]:
                    if key in data:
                        dimensions = extract_dimensions_reliable(str(data[key]))
                        if dimensions != "N/A":
                            return dimensions
            except:
                pass
        
        return "N/A"
        
    except requests.exceptions.Timeout:
        return "N/A"
    except requests.RequestException:
        return "N/A"
    except Exception:
        return "N/A"
def process_split_inputs():
    """Process all JSON files from split_inputs folder and scrape dimensions"""
    ROOT_DIR = Path(__file__).parent
    INPUT_DIR = ROOT_DIR / "split_inputs"
    OUTPUT_DIR = ROOT_DIR / "split_output"
    
    # Create output directory if it doesn't exist
    OUTPUT_DIR.mkdir(exist_ok=True)
    
    # Get all JSON files from split_inputs
    input_files = list(INPUT_DIR.glob("*.json"))
    
    if not input_files:
        print("[INFO] No JSON files found in split_inputs folder")
        return
    
    print("=" * 70)
    print("IKEA Dimensions Scraper (Reliable Mode)")
    print("=" * 70)
    print(f"\n[INFO] Found {len(input_files)} file(s) to process\n")
    
    total_products = 0
    total_with_dims = 0
    
    for input_file in sorted(input_files):
        print(f"\n[PROCESSING] {input_file.name}")
        print("-" * 70)
        
        try:
            # Load input data
            with open(input_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            products = data.get("products", [])
            print(f"[INFO] Found {len(products)} products")
            
            file_dims_count = 0
            
            # Process each product
            for idx, product in enumerate(products, 1):
                product_name = product.get("Product Name", "Unknown")
                product_url = product.get("Product URL", "")
                
                # Truncate long names for display
                display_name = product_name[:28] + "..." if len(product_name) > 28 else product_name
                print(f"  [{idx:3d}/{len(products)}] {display_name:<35}", end=" ", flush=True)
                
                if product_url:
                    dimensions = scrape_dimensions(product_url)
                    product["Dimensions"] = dimensions
                    
                    if dimensions != "N/A":
                        file_dims_count += 1
                        total_with_dims += 1
                        print(f"[OK] {dimensions}")
                    else:
                        print(f"[NONE]")
                    
                    # Be nice to the server - add small delay
                    time.sleep(0.2)
                else:
                    print("[SKIP] No URL")
                
                total_products += 1
            
            # Save output file
            output_file = OUTPUT_DIR / input_file.name
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            print(f"\n[SUCCESS] Saved: {output_file.name} ({file_dims_count}/{len(products)} dimensions found)")
            
        except json.JSONDecodeError as e:
            print(f"\n[ERROR] Invalid JSON in {input_file.name}: {str(e)}")
        except Exception as e:
            print(f"\n[ERROR] Processing {input_file.name}: {str(e)}")
    
    print("\n" + "=" * 70)
    print("[COMPLETED] All files processed!")
    print(f"[STATS] {total_with_dims}/{total_products} products have dimensions")
    print(f"[OUTPUT] Results saved in: split_output/")
    print("=" * 70)


# ----------------------------
# MAIN
# ----------------------------
if __name__ == "__main__":
    process_split_inputs()
