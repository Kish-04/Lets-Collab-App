fetch('https://api.github.com/repos/Kish-04/Let-s-Collab-/releases')
  .then(res => {
    console.log("Status:", res.status);
    return res.json();
  })
  .then(data => {
    if (data && data.length > 0) {
      console.log("Release assets:", JSON.stringify(data[0].assets.map(a => a.browser_download_url), null, 2));
    } else {
      console.log(data);
    }
  })
  .catch(err => console.error("Error:", err));
