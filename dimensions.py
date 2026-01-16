import json
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

def scrape_ikea_data(url):
    response = requests.get(url, headers=HEADERS, timeout=15)
    soup = BeautifulSoup(response.text, "html.parser")

    # ----------------------------
    # DIMENSIONS
    # ----------------------------
    dimensions = "N/A"
    specs = soup.find_all("span")
    for span in specs:
        if span.text and "cm" in span.text:
            dimensions = span.text.strip()
            break

    # ----------------------------
    # RATING (often JS-loaded)
    # ----------------------------
    rating = 0
    rating_tag = soup.select_one("[aria-label*='out of 5 stars']")
    if rating_tag:
        rating = rating_tag["aria-label"]

    return rating, dimensions


# ----------------------------
# MAIN
# ----------------------------
with open("input.json", "r", encoding="utf-8") as f:
    data = json.load(f)

for product in data["products"]:
    print(f"Scraping {product['Product Name']}...")
    rating, dimensions = scrape_ikea_data(product["Product URL"])

    product["Rating"] = rating
    product["Dimensions"] = dimensions

with open("output.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print("✅ Done. Data filled.")
