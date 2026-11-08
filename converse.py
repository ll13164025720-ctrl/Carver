import boto3
import os
import requests
import json

from bs4 import BeautifulSoup
from urllib.parse import urlparse

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

# The message you want to send to the model
url = "https://www.example.com"  # Replace with the URL of the website you want to analyze

response = requests.get(
    url,
    timeout=15,
    headers = {"User-Agent": "Carver"}
)

response.raise_for_status()
html = response.text
soup = BeautifulSoup(html, "html.parser")

title = soup.title.get_text(strip=True) if soup.title else "No title"

for element in soup(["script", "style", "noscript"]):
    element.decompose()

website_text = soup.get_text(separator=" ", strip=True)
user_message = f"""
Analyze the following website content and provide all the information necessary to create an updated version of the website. Format it to a prompt that an AI can code it from the prompt:

URL: {url}
Title: {title}
Content: {website_text}

Include:
1. What is the purpose of this website?
2. What are its main features?
3. What is its layout and design?
4. What sections does it contain?
5. How could this website be recreated?
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
        inferenceConfig={"maxTokens": 512},
    )

    response_actual = response["output"]["message"]["content"]

    # Some models provide reasoning context and lay out this JSON differently
    # Ex: reasoningContent comes after the main text response, so swap [0] and [1]
    # You can always debug by printing the full response
    # print(response_actual)

    if response_actual[0].get("reasoningContent"):
        reasoning_text = response_actual[0]["reasoningContent"]["reasoningText"]["text"]
        print("Reasoning:")
        print(reasoning_text)
        response_text = response_actual[1]["text"]
    else:
        response_text = response_actual[0]["text"]

    print("\nResponse:")
    print(response_text)
except Exception as e:
    print(f"ERROR: Can't invoke '{model_id}'. Reason: {e} (Exception type: {type(e).__name__})")
