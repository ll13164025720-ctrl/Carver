"""Reusable website analyzer.

Crawls a site (same-domain, capped), sends the combined page content to
Amazon Bedrock, and RETURNS the model's response text so another file can
access it:

    from site_analyzer import analyze_site
    result = analyze_site("https://www.example.com")   # <- AI response here

Running this file directly (`python site_analyzer.py [url]`) prints the result.
"""

import boto3
import os
import sys
import requests

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

# Inference profile ID (requires us. prefix); allowlisted in the Workshop account
model_id = "us.anthropic.claude-sonnet-5"

MAX_PAGES = 5  # Cap how many pages to crawl so token usage/runtime stays bounded


def scrape_page(page_url):
    """Fetch one page and return (title, cleaned_text, soup) or None on failure."""
    try:
        resp = requests.get(page_url, timeout=15, headers={"User-Agent": "Carver"})
        resp.raise_for_status()
    except requests.RequestException as err:
        print(f"Skipping {page_url}: {err}", file=sys.stderr)
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


def crawl_site(url, max_pages=MAX_PAGES):
    """Breadth-first crawl, same domain only, returns a list of (url, title, text)."""
    start_host = urlparse(url).netloc
    queue = deque([url])
    visited = set()
    pages = []

    while queue and len(pages) < max_pages:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)

        result = scrape_page(current)
        if result is None:
            continue

        page_title, page_text, page_soup = result
        pages.append((current, page_title, page_text))

        for link in internal_links(page_soup, current, start_host):
            if link not in visited:
                queue.append(link)

    return pages


def build_prompt(url, pages):
    combined_content = "\n\n".join(
        f"--- PAGE: {page_url} ---\nTitle: {page_title}\nContent: {page_text}"
        for page_url, page_title, page_text in pages
    )
    return f"""
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


def analyze_site(url, max_tokens=4000):
    """Crawl `url`, send it to Bedrock, and RETURN the model's response text.

    This is how another file accesses the AI response: call this function and
    use its return value. Raises on failure so the caller can handle it.
    """
    pages = crawl_site(url)

    conversation = [
        {
            "role": "user",
            "content": [{"text": build_prompt(url, pages)}],
        }
    ]

    response = client.converse(
        modelId=model_id,
        messages=conversation,
        inferenceConfig={"maxTokens": max_tokens},
    )

    response_actual = response["output"]["message"]["content"]

    # Some models return a reasoning block first; take the last text block.
    text_blocks = [block["text"] for block in response_actual if "text" in block]
    if not text_blocks:
        raise ValueError("The model returned no text content.")
    return text_blocks[-1].strip()


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.example.com"
    try:
        response_text = analyze_site(target_url)
        print(response_text)
    except Exception as e:
        print(
            f"ERROR: Can't invoke '{model_id}'. Reason: {e} (Exception type: {type(e).__name__})",
            file=sys.stderr,
        )
        sys.exit(1)
