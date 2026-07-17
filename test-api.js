const http = require('http');

http.get('http://localhost:3000/api/customers?tab=active', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("STATUS:", res.statusCode);
    if (res.statusCode !== 200) {
      console.log("BODY (ERROR):", data.slice(0, 1000));
    } else {
      const arr = JSON.parse(data);
      console.log("SUCCESS! API returned array of length:", arr.length);
      if (arr.length > 0) {
        console.log("First item:", JSON.stringify(arr[0]).slice(0, 200));
      }
    }
  });
}).on("error", (err) => {
  console.log("Error fetching API:", err.message);
});
