"""
TTS 语音合成 — 使用 OpenVoice 音色克隆
基于 whisper/reference/separated/vocals.wav 的沈幼楚原声

用法: python scripts/tts.py "要说的文字" [output_path]
"""

import os, sys, json
import soundfile as sf

REFERENCE_VOICE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "whisper", "reference", "separated", "vocals.wav"
)

def synthesize(text, output_path=None):
    if output_path is None:
        output_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "data", "media", "voices", "replies",
            f"tts_{hash(text) & 0xFFFFFFFF}.wav"
        )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    try:
        from openvoice import OpenVoiceTTS
        tts = OpenVoiceTTS()
        tts.synthesize(
            text=text,
            reference_audio=REFERENCE_VOICE,
            output_path=output_path,
            language="zh",
        )
        return {"path": output_path, "success": True}
    except ImportError:
        return {
            "path": None,
            "success": False,
            "error": "openvoice 未安装，请执行: pip install openvoice",
            "fallback": True,
        }
    except Exception as e:
        return {"path": None, "success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python scripts/tts.py <text>"}, ensure_ascii=False))
        sys.exit(1)
    result = synthesize(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
