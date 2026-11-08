import boto3
import os
import requests
import json

from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
from collections import deque

# Reads credentials set by the 1-setup tutorial
client = boto3.client(
    service_name="bedrock-runtime",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    aws_session_token=os.getenv("AWS_SESSION_TOKEN"),
    region_name="us-east-1",
)

# The model or inference ID for the model you want to use
# !If you get an error with "Retry your request with the ID or ARN", use the inference ID version below

model_id = "us.anthropic.claude-sonnet-5"  # Inference profile ID (requires us. prefix); allowlisted in the Workshop account

# Some models don't require an inference profile and use a plain Model ID instead:
# model_id = "amazon.titan-text-lite-v1"

# The website you want to analyze
url = "https://www.example.com"  # Replace with the URL of the website you want to analyze
MAX_PAGES = 5  # Cap how many pages to crawl so token usage/runtime stays bounded


def scrape_page(page_url):
    """Fetch one page and return (title, cleaned_text, soup) or None on failure."""
    try:
        resp = requests.get(page_url, timeout=15, headers={"User-Agent": "Carver"})
        resp.raise_for_status()
    except requests.RequestException as err:
        print(f"Skipping {page_url}: {err}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    page_title = soup.title.get_text(strip=True) if soup.title else "No title"

    for element in soup(["script", "style", "noscript"]):
        element.decompose()

    text = soup.get_text(separator=" ", strip=True)
    return page_title, text, soup


def internal_links(soup, base_url, same_host):
    """Return same-domain links found on the page, with fragments removed."""
    found = set()
    for anchor in soup.find_all("a", href=True):
        absolute = urljoin(base_url, anchor["href"])
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue  # skip mailto:, tel:, javascript:, etc.
        if parsed.netloc != same_host:
            continue  # same domain only
        found.add(absolute.split("#")[0])  # drop #anchors
    return found


# Breadth-first crawl starting from `url`, staying on the same domain,
# visiting at most MAX_PAGES pages.
start_host = urlparse(url).netloc
queue = deque([url])
visited = set()
pages = []  # list of (page_url, title, text)

while queue and len(pages) < MAX_PAGES:
    current = queue.popleft()
    if current in visited:
        continue
    visited.add(current)

    result = scrape_page(current)
    if result is None:
        continue

    page_title, page_text, page_soup = result
    pages.append((current, page_title, page_text))

    # Queue up newly discovered subpages
    for link in internal_links(page_soup, current, start_host):
        if link not in visited:
            queue.append(link)

print(f"Crawled {len(pages)} page(s):")
for page_url, page_title, _ in pages:
    print(f"  - {page_title} ({page_url})")

# Combine every crawled page into the content the model will analyze
combined_content = "\n\n".join(
    f"--- PAGE: {page_url} ---\nTitle: {page_title}\nContent: {page_text}"
    for page_url, page_title, page_text in pages
)

user_message = f"""
Analyze the following website content and provide all the information necessary to create an updated version of the website. The site has multiple pages, each delimited below. Format it to a prompt that an AI can code it from the prompt:

Root URL: {url}
Number of pages: {len(pages)}

{combined_content}

Include:
1. What is the purpose of this website?
2. What are its main features?
3. What is its layout and design?
4. What sections and subpages does it contain?
5. How could this website (including its subpages) be recreated?
"""

conversation = [
    {
        "role": "user",
        "content": [{"text": user_message}],
    }
]
try:
    response = client.converse(
        modelId=model_id,
        messages=conversation,
        inferenceConfig={"maxTokens": 4000},
    )

    response_actual = response["output"]["message"]["content"]

    # Some models provide reasoning context and lay out this JSON differently
    # Ex: reasoningContent comes after the main text response, so swap [0] and [1]
    # You can always debug by printing the full response
    # print(response_actual)

    if response_actual[0].get("reasoningContent"):
        reasoning_text = response_actual[0]["reasoningContent"]["reasoningText"]["text"]
        response_text = response_actual[1]["text"]
    else:
        response_text = response_actual[0]["text"]

    # The AI response is now held in `response_text` for later use
    # (e.g. passing it to another step) instead of being printed.
except Exception as e:
    print(f"ERROR: Can't invoke '{model_id}'. Reason: {e} (Exception type: {type(e).__name__})")
