async function run() {
  try {
    const res = await fetch("http://localhost:3000/api/repair-names", { method: "POST" });
    const text = await res.text();
    console.log(res.status, text);
  } catch(e) {
    console.error(e);
  }
}
run();
