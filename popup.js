document.getElementById("save").addEventListener("click", () => {
  const repo = document.getElementById("repo").value;
  const token = document.getElementById("token").value;

  chrome.storage.sync.set({ repo, token }, () => {
    alert("Saved successfully!");
  });
});

window.onload = () => {
  chrome.storage.sync.get(["repo", "token"], ({ repo, token }) => {
    if (repo) document.getElementById("repo").value = repo;
    if (token) document.getElementById("token").value = token;
  });
};
