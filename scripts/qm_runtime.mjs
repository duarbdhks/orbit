export function withCodexRuntime(config, credential) {
  if (!credential) return config;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(credential)) throw new Error("Invalid Codex credential id");
  const core = config.env?.core ?? {};
  const origins = new Set((core.PRIVATE_NETWORK_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean));
  origins.add("http://orbit-api");
  return {
    ...config,
    secretEnv: {
      ...config.secretEnv,
      core: { ...config.secretEnv?.core, CODEX_AUTH_CREDENTIAL: "ORBIT_CODEX_AUTH_CREDENTIAL" },
    },
    env: {
      ...config.env,
      core: {
        ...core,
        PI_MODEL: "gpt-6.1-sol",
        PRIVATE_NETWORK_ALLOWED_ORIGINS: [...origins].join(","),
      },
    },
  };
}
