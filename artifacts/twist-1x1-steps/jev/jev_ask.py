import json, sys
from typesafe_sdk import TypeSafeClient
d = json.load(sys.stdin)
c = TypeSafeClient(api_key='injected-by-proxy', timeout=120)
q = {"pick": {"type": "choice", "instructions": {"question": d["question"], "goal": d["goal"]}, "criteria": d["choices"]}}
r = c.system_one(state=d["state"], questions=q)
a = r.answers["pick"]
print(json.dumps({"choice": a.choice, "confidence": a.confidence, "probabilities": a.probabilities}))
