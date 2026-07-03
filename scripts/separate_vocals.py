"""
人声分离：从音频中提取纯净人声（去除 BGM）
用法: python scripts/separate_vocals.py <input_wav>
直接使用 soundfile + demucs，绕过 torchaudio 后端问题
"""

import os, sys, torch
import soundfile as sf
import numpy as np

def separate_vocals(input_path, output_dir=None):
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(input_path), "separated")
    os.makedirs(output_dir, exist_ok=True)

    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    # 加载模型
    print("加载 Demucs 模型（首次会下载约 80MB）...")
    model = get_model("htdemucs")
    model.cpu()
    model.eval()

    # 用 soundfile 读取音频
    print(f"读取音频: {input_path}")
    wav_np, sr = sf.read(input_path)
    if wav_np.ndim == 1:
        wav_np = np.stack([wav_np, wav_np], axis=0)  # mono -> stereo
    else:
        wav_np = wav_np.T  # (samples, channels) -> (channels, samples)

    wav = torch.from_numpy(wav_np).float()

    # 分离
    print("分离中（这可能需要一两分钟）...")
    with torch.no_grad():
        ref = wav.mean() * 1e-6
        wav = wav - wav.mean() + ref  # 去直流
        sources = apply_model(model, wav.unsqueeze(0), device='cpu')[0]

    # htdemucs: drums, bass, other, vocals
    vocals = sources[3].cpu().numpy()
    vocal_mono = np.mean(vocals, axis=0)

    no_vocals = np.mean(sources[:3].sum(dim=0).cpu().numpy(), axis=0)

    # 保存
    vocal_path = os.path.join(output_dir, "vocals.wav")
    bgm_path = os.path.join(output_dir, "no_vocals.wav")
    sf.write(vocal_path, vocal_mono, sr)
    sf.write(bgm_path, no_vocals, sr)

    print(f"✅ 人声: {vocal_path} ({len(vocal_mono)/sr:.1f}s)")
    print(f"✅ 伴奏: {bgm_path}")
    return vocal_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scripts/separate_vocals.py <input_wav>")
        sys.exit(1)
    separate_vocals(sys.argv[1])
