const providerSelect = document.getElementById("aiProvider");
const groqInput = document.getElementById("groqApiKey");
const openaiInput = document.getElementById("openaiApiKey");
const statusEl = document.getElementById("status");

// Greys out whichever key field isn't the active provider - it's just a
// visual cue about what currently matters, not a clear: both keys stay in
// storage and in the (disabled) field's value either way.
function updateProviderFieldState() {
  const isOpenAI = providerSelect.value === "openai";
  groqInput.disabled = isOpenAI;
  openaiInput.disabled = !isOpenAI;
}
providerSelect.addEventListener("change", updateProviderFieldState);

document.getElementById("save").addEventListener("click", () => {
  const repo = document.getElementById("repo").value;
  const token = document.getElementById("token").value;
  const aiProvider = providerSelect.value;
  const groqApiKey = groqInput.value;
  const openaiApiKey = openaiInput.value;

  chrome.storage.sync.set({ repo, token, aiProvider, groqApiKey, openaiApiKey }, () => {
    statusEl.classList.add("visible");
    setTimeout(() => statusEl.classList.remove("visible"), 1600);
  });
});

window.onload = () => {
  chrome.storage.sync.get(
    ["repo", "token", "aiProvider", "groqApiKey", "openaiApiKey"],
    ({ repo, token, aiProvider, groqApiKey, openaiApiKey }) => {
      if (repo) document.getElementById("repo").value = repo;
      if (token) document.getElementById("token").value = token;
      if (aiProvider) providerSelect.value = aiProvider;
      if (groqApiKey) groqInput.value = groqApiKey;
      if (openaiApiKey) openaiInput.value = openaiApiKey;
      updateProviderFieldState();
    }
  );
};
