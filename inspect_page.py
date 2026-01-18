import requests
from bs4 import BeautifulSoup
import json

url = 'https://www.ikea.com/in/en/p/stickat-bed-pocket-black-60378339/'
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

try:
    response = requests.get(url, headers=headers, timeout=10)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Check for JSON-LD
    json_ld = soup.find('script', {'type': 'application/ld+json'})
    if json_ld:
        try:
            data = json.loads(json_ld.string)
            print("=== JSON-LD DATA FOUND ===")
            if 'aggregateRating' in data:
                print(f"Rating: {data['aggregateRating']}")
            if 'offers' in data:
                print(f"Offer info available")
            # Save a sample
            with open('sample_jsonld.json', 'w') as f:
                json.dump(data, f, indent=2)
            print("\nSample saved to sample_jsonld.json")
        except:
            print("JSON-LD found but couldn't parse")
    else:
        print("No JSON-LD found")
    
    # Look for dimensions
    import re
    text = soup.get_text()
    dims = re.findall(r'\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*cm', text)
    print(f"\nDimensions found: {dims[:5] if dims else 'None'}")
    
except Exception as e:
    print(f'Error: {e}')
