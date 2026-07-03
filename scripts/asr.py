"""
本地语音转文字（ASR） — 使用 faster-whisper
用法: python asr.py <audio_path>
输出: JSON {"transcript": "...", "language": "zh"}
"""

import json
import sys
import os
from faster_whisper import WhisperModel

# 模型目录（放在项目 whisper/ 下）
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "whisper", "models")
os.makedirs(MODEL_DIR, exist_ok=True)

def transcribe(audio_path):
    if not os.path.exists(audio_path):
        return {"error": f"文件不存在: {audio_path}"}

    # 使用 tiny 模型（最快，约 1GB 内存）
    # 可改为 'base'（更准但稍慢）、'small'、'medium'
    model_size = os.environ.get("WHISPER_MODEL", "base")

    try:
        model = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",  # int8 量化，内存占用更低
            download_root=MODEL_DIR,
        )

        segments, info = model.transcribe(audio_path, language="zh", beam_size=3)

        transcript = " ".join(seg.text for seg in segments)
        language = info.language if info else "zh"

        return {"transcript": transcript.strip(), "language": language}

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python asr.py <audio_path>"}))
        sys.exit(1)

    result = transcribe(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
