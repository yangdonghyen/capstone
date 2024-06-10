const express = require("express");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const ejs = require("ejs");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const archiver = require("archiver");
const stream = require("stream");
const { GridFSBucket } = require("mongodb");
const http = require("http");
const socketIo = require("socket.io");
const pty = require("node-pty");

const app = express();
const port = process.env.PORT || 55000;

const wss = new WebSocket.Server({ port: 3001 }); // WebSocket 서버 설정

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "disk-image-recovery", "views"));

app.use(express.static(path.join(__dirname, "disk-image-recovery", "public")));
app.use(
  "/predefined_images",
  express.static(path.join(__dirname, "disk-image-recovery", "predefined_images"))
);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });
let uploads = [];
let recoveredFiles = [];

// MongoDB 연결 설정
const mongoURI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/file_recovery";

mongoose
  .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log("Connected to MongoDB.");
  })
  .catch((err) => {
    console.error("Database connection failed:", err);
    process.exit(1);
  });

const conn = mongoose.connection;
let gridFSBucket;

conn.once("open", () => {
  gridFSBucket = new GridFSBucket(conn.db, {
    bucketName: "uploads",
  });
  console.log("GridFS Bucket set up.");
});

const uploadSchema = new mongoose.Schema({
  originalFilename: { type: String, required: true },
  filePath: { type: String, required: true },
  uploadTime: { type: Date, default: Date.now },
});

const outputSchema = new mongoose.Schema({
  uploadId: { type: mongoose.Schema.Types.ObjectId, required: true },
  filename: { type: String, required: true },
  filePath: { type: String, required: true },
});

const Upload = mongoose.model("Upload", uploadSchema);
const Output = mongoose.model("Output", outputSchema);

// 홈 페이지 라우트
app.get("/", async (req, res) => {
  try {
    const uploads = await Upload.find();
    const recoveredFiles = await Output.distinct("uploadId");
    res.render("index", {
      uploads: uploads,
      recoveredFiles: recoveredFiles,
    });
  } catch (err) {
    console.error("Error fetching uploads from DB:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Recovery 페이지 라우트
app.get("/recovery", async (req, res) => {
  try {
    const uploads = await Upload.find();
    const recoveredFiles = await Output.distinct("uploadId");
    res.render("recovery", {
      uploads: uploads,
      recoveredFiles: recoveredFiles,
    });
  } catch (err) {
    console.error("Error fetching uploads from DB:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    console.error("File upload failed");
    return res.redirect("/recovery");
  }

  const originalFilename = req.file.originalname;
  const filePath = req.file.path;

  try {
    const newUpload = new Upload({ originalFilename, filePath });
    await newUpload.save();
    console.log("File uploaded successfully:", originalFilename);
    res.redirect("/recovery");
  } catch (err) {
    console.error("Error saving upload to DB:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/delete/:id", async (req, res) => {
  const uploadId = req.params.id;

  try {
    await Upload.findByIdAndDelete(uploadId);
    await Output.deleteMany({ uploadId });
    res.redirect("/recovery");
  } catch (err) {
    console.error("Error deleting upload from DB:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/recover/:id", async (req, res) => {
  const uploadId = req.params.id;

  try {
    const file = await Upload.findById(uploadId);
    if (!file) {
      return res.status(404).send("File not found");
    }

    const tempFilePath = path.join(__dirname, file.filePath);
    const outputDir = path.join(__dirname, "temp", file._id.toString());
    const recoveredDir = path.join(
      __dirname,
      "recovered_files",
      file._id.toString()
    );
    const logFilePath = path.join(__dirname, `photorec_log_${uploadId}.txt`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (!fs.existsSync(recoveredDir)) {
      fs.mkdirSync(recoveredDir, { recursive: true });
    }

    const runPhotoRec = (
      tempFilePath,
      outputDir,
      res,
      uploadId,
      recoveredDir
    ) => {
      const photorecPath = path.join(__dirname, "tools", "photorec_static");
      const outputDirEscaped = outputDir.replace(/\\/g, '\\\\');
      const command = `"${photorecPath}" /log /d "${outputDirEscaped}" /cmd "${tempFilePath.replace(/\\/g, '\\\\')}" search`;

      console.log("Executing command:", command);

      const child = spawn(command, { shell: true });

      let logData = "";

      child.stdout.on("data", (data) => {
        console.log(`stdout: ${data}`);
        logData += data.toString();
      });

      child.stderr.on("data", (data) => {
        console.error(`stderr: ${data}`);
        logData += data.toString();
      });

      child.on("error", (error) => {
        console.error(`Error running PhotoRec: ${error.message}`);
        res.status(500).send("Internal Server Error");
      });

      child.on("exit", async (code) => {
        console.log(`PhotoRec exited with code ${code}`);
        fs.writeFileSync(logFilePath, logData);
        if (code !== 0) {
          console.error(`PhotoRec exited with code ${code}`);
          const logContent = fs.readFileSync(logFilePath, "utf8");
          console.error(`PhotoRec log: ${logContent}`);
          res
            .status(500)
            .send(`PhotoRec exited with code ${code}\n${logContent}`);
          return;
        }

        const getAllFiles = (dirPath, arrayOfFiles) => {
          let files = fs.readdirSync(dirPath);
          arrayOfFiles = arrayOfFiles || [];

          files.forEach((file) => {
            if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
              arrayOfFiles = getAllFiles(
                path.join(dirPath, file),
                arrayOfFiles
              );
            } else {
              arrayOfFiles.push(path.join(dirPath, file));
            }
          });

          return arrayOfFiles;
        };

        const recoveredFiles = getAllFiles(outputDir);
        console.log(`Recovered files: ${recoveredFiles}`);

        if (recoveredFiles.length === 0) {
          console.error("No files recovered by PhotoRec.");
          return res.status(500).send("No files recovered");
        }

        try {
          for (const filePath of recoveredFiles) {
            const filename = path.basename(filePath);
            const destinationPath = path.join(recoveredDir, filename);
            console.log(`Moving file to: ${destinationPath}`);

            fs.renameSync(filePath, destinationPath);

            console.log(
              `Inserting into DB - File: ${filename}, Path: ${destinationPath}`
            );

            const newOutput = new Output({
              uploadId,
              filename,
              filePath: destinationPath,
            });
            await newOutput.save();
          }

          fs.unlinkSync(tempFilePath);
          fs.rmSync(outputDir, { recursive: true, force: true });

          res.redirect(`/results/${uploadId}`);
        } catch (err) {
          console.error("Error inserting recovered files:", err);
          res.status(500).send("Internal Server Error");
        }
      });
    };

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send("open_viewer");
      }
    });

    runPhotoRec(tempFilePath, outputDir, res, file._id, recoveredDir);
  } catch (err) {
    console.error("Error fetching upload from DB:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/viewer", (req, res) => {
  const predefinedImagesDir = path.join(__dirname, "predefined_images");

  const getAllFiles = (dirPath, arrayOfFiles = []) => {
    let files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
        arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
      } else {
        arrayOfFiles.push({
          filename: file,
          webPath: `/predefined_images/${file}`,
        });
      }
    });

    return arrayOfFiles;
  };

  const files = getAllFiles(predefinedImagesDir);

  res.render("viewer", { files });
});

app.get("/results/:uploadId", async (req, res) => {
  const uploadId = req.params.uploadId;

  try {
    const results = await Output.find({ uploadId });
    const files = results.map((row) => ({
      filename: row.filename,
      filePath: row.filePath,
    }));
    console.log(`Files in results: ${files}`);
    res.render("results", { files });
  } catch (err) {
    console.error("Error fetching results from DB:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/download/:uploadId/:filename", (req, res) => {
  const uploadId = req.params.uploadId;
  const filename = req.params.filename;
  const filePath = path.join(
    __dirname,
    "recovered_files",
    uploadId.toString(),
    filename
  );

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error("Error downloading file:", err);
      res.status(500).send("Internal Server Error");
    }
  });
});
app.get("/do", (req, res) => {
  res.sendFile(path.join(__dirname, "disk-image-recovery", "public", "do.html"));
});

app.get("/tool", (req, res) => {
  res.sendFile(path.join(__dirname, "disk-image-recovery", "public", "tool.html"));
});

app.get("/help", (req, res) => {
  res.sendFile(path.join(__dirname, "disk-image-recovery", "public", "help.html"));
});
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

app.get("/", (req, res) => {
  res.render("index", { uploads: [], recoveredFiles: [] });
});
