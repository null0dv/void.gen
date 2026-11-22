"""Tag-style prompt -> natural-language prompt, for engines whose text encoder is a language model
(Qwen / Moody Moss / Z-Image / Klein). The conversion itself is done by the local Ollama model."""
import re

SYSTEM = (
    "You rewrite Stable Diffusion tag-style prompts into one fluent natural-language image description "
    "for a modern text-to-image model whose text encoder is a large language model.\n"
    "Rules:\n"
    "- Keep every concrete visual element: subject(s), age/appearance, clothing, pose, expression, setting, lighting, camera angle, art style.\n"
    "- Drop quality boilerplate (masterpiece, best quality, 8k, highres, etc.) and attention weights like (word:1.2).\n"
    "- Do not invent new characters or objects, and do not omit or soften any element the prompt asks for.\n"
    "- Text that must appear inside the image (in quotes) stays verbatim.\n"
    "- Write 2 to 5 sentences in English, plain prose, no lists, no markdown.\n"
    "- Output only the description."
)


REALISTIC_SYSTEM = (
    "You rewrite an image prompt (often anime / illustration tags) into one photorealistic live-action photograph description "
    "for a modern text-to-image model whose text encoder is a large language model.\n"
    "Rules:\n"
    "- Keep the subject, outfit, pose, expression, setting and mood. Everything described is an adult (18+): describe people as adult women or men.\n"
    "- Remove anime / illustration vocabulary (anime, 2d, cel shading, lineart, chibi, manga, art style names, LoRA trigger words, quality boilerplate, attention weights).\n"
    "- Add natural photographic cues: real person, realistic skin texture, camera and lens feel, natural light, shallow depth of field, candid or editorial photo look.\n"
    "- Do not invent new characters or objects.\n"
    "- If the prompt describes a child or minor, output exactly: REFUSE\n"
    "- Otherwise write 3 to 6 sentences of English prose, no lists, no markdown, output only the description."
)
REALISTIC_NEGATIVE = "anime, cartoon, illustration, drawing, painting, 3d render, cgi, plastic skin, oversharpened, deformed hands, extra fingers, watermark, text"
MINOR = re.compile(
    r"\b(loli|lolita|shota|child|children|kid|kids|toddler|infant|baby|underage|little (?:girl|boy)|young (?:girl|boy)|"
    r"elementary|middle school|junior high|preteen|pre-teen|minor)\b|蘿莉|萝莉|正太|幼女|幼童|兒童|儿童|小孩|小學|小学|國中|国中|未成年",
    re.I)


def is_minor_coded(prompt):
    return bool(MINOR.search(str(prompt)))


def looks_like_tags(prompt):
    """True for comma-separated short phrases (SDXL / booru style); False for sentences."""
    parts = [p.strip() for p in re.split(r'[,，、\n]+', str(prompt)) if p.strip()]
    if len(parts) < 4:
        return False
    short = sum(1 for p in parts if len(p.split()) <= 4 and len(p) <= 40)
    return short / len(parts) >= 0.7


def build_messages(prompt, mode='natural'):
    system = REALISTIC_SYSTEM if mode == 'realistic' else SYSTEM
    return [{'role': 'system', 'content': system}, {'role': 'user', 'content': str(prompt)[:4000]}]


def clean_output(text):
    text = str(text or '').strip()
    text = re.sub(r'^```[a-z]*\s*|\s*```$', '', text, flags=re.I).strip()
    text = re.sub(r'^(description|prompt|output)\s*[:：]\s*', '', text, flags=re.I).strip()
    if len(text) > 1 and text[0] == text[-1] and text[0] in '"\'“':
        text = text[1:-1].strip()
    text = re.sub(r'\s+', ' ', text)
    return text[:3000]