import os
from typing import Optional, List
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def make_query_embedding(q: str) -> Optional[List[float]]:
    if not os.getenv("OPENAI_API_KEY"):
        return None

    text = q.strip()
    if not text:
        return None

    try:
        res = client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return res.data[0].embedding
    except Exception as e:
        print("[Embedding Error]", e)
        return None


def make_product_embedding(name: str, category: str) -> Optional[List[float]]:
    if not os.getenv("OPENAI_API_KEY"):
        return None

    text = f"{name} | {category}".strip()

    try:
        res = client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return res.data[0].embedding
    except Exception as e:
        print("[Embedding Error]", e)
        return None