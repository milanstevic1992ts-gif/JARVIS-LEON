# Hey Jarvis wake word

JARVIS does **not** reuse the upstream `Hey_Leon.onnx` model under a different name.

The configured wake-word filename is:

```
Hey_Jarvis.onnx
```

Until a real OpenWakeWord-compatible model trained for "Hey Jarvis" is added to the installed audio model directory, wake-word mode should remain disabled.

Push-to-talk / manual microphone mode can still use the local ASR and TTS resources independently.
