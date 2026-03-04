import urllib.request
from bs4 import BeautifulSoup
import json
import time

base_url = "https://www.feedtables.com"

# Dictionary to hold the final structured data
feed_data = {}

def get_html(url):
    print(f"Fetching: {url}")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            return response.read()
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def scrape_categories():
    html = get_html(f"{base_url}/content/table-dry-matter")
    if not html: return []
    
    soup = BeautifulSoup(html, 'html.parser')
    categories = []
    
    # In feedtables, the main categories are often found in a block or list.
    # We will try to find links that look like category links or ingredient links.
    # For a robust script, we'll start from the main table page and find all ingredient links.
    
    # Specifically looking for the main table rows
    table = soup.find('table')
    if not table:
        print("Could not find main table.")
        return []
        
    for row in table.find_all('tr'):
        link = row.find('a')
        if link and 'href' in link.attrs:
            href = link['href']
            name = link.text.strip()
            if href.startswith('/content/'):
                categories.append({
                    'name': name,
                    'url': f"{base_url}{href}"
                })
    return categories

def scrape_ingredient_details(url):
    html = get_html(url)
    if not html: return None
    
    soup = BeautifulSoup(html, 'html.parser')
    nutrients = {}
    
    # Find all tables on the ingredient page
    tables = soup.find_all('table')
    for table in tables:
        for row in table.find_all('tr'):
            cols = row.find_all(['td', 'th'])
            if len(cols) >= 2:
                # Assuming first col is nutrient name, last col or second col is value
                nutrient_name = cols[0].text.strip()
                # Finding the first cell that looks like a number
                value = None
                for col in cols[1:]:
                    text_val = col.text.strip().replace(',', '.')
                    try:
                        value = float(text_val)
                        break
                    except ValueError:
                        continue
                
                if nutrient_name and value is not None:
                    nutrients[nutrient_name] = value
                    
    return nutrients

def main():
    print("Starting scraping process...")
    ingredients_list = scrape_categories()
    print(f"Found {len(ingredients_list)} ingredients/categories to scrape.")
    
    # Only scraping a few for demonstration if it's too large, but user wants all.
    # Since scraping thousands might take a while and fail halfway, we'll save incrementally or as a batch.
    
    final_data = []
    for count, item in enumerate(ingredients_list):
        print(f"[{count+1}/{len(ingredients_list)}] Scraping {item['name']}...")
        details = scrape_ingredient_details(item['url'])
        if details:
            parsed_item = {
                'id': item['name'].lower().replace(' ', '_').replace(',', ''),
                'name': item['name'],
                'nutrients': details
            }
            final_data.append(parsed_item)
        time.sleep(1) # Be polite to the server
        
    # Save to JSON
    output_file = 'feedtables_data.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, indent=4, ensure_ascii=False)
        
    print(f"Successfully saved {len(final_data)} ingredients to {output_file}")

if __name__ == "__main__":
    main()
