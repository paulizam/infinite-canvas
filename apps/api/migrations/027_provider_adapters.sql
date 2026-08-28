ALTER TABLE model_protocols DROP CONSTRAINT IF EXISTS model_protocols_adapter_check;
ALTER TABLE model_protocols ADD CONSTRAINT model_protocols_adapter_check
  CHECK (adapter IN ('openai-compatible','gemini','seedance','stable-diffusion','media-kit','custom'));
