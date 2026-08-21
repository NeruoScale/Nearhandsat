require("dotenv").config();
const express = require("express");
const cors = require("cors");

require("./db"); // initializes + seeds sqlite db on first run

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/artisans", require("./routes/artisans"));
app.use("/api/leads", require("./routes/leads"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/admin", require("./routes/admin"));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`NearHandsAT API running on http://localhost:${PORT}`));
