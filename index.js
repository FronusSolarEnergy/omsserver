require("dotenv").config();
const express = require("express");
const session = require("express-session");
const app = express();
const mysql = require("mysql");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const multer = require("multer");
const xlsx = require("xlsx");
const util = require("util");
// Set up multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + file.originalname);
  },
});

const upload = multer({ storage: storage });

const http = require("http");
const WebSocket = require("ws");
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.on("message", (message) => {
    console.log(`Received: ${message}`);
    // Broadcast to all clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

app.use(express.json());
app.use(
  cors({
    origin: "https://oms.fronus.com:80", // Allow requests from your frontend
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Allow these HTTP methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allow these headers
  })
);
app.options("*", cors());

// Session management middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-default-secret", // Use .env to store this
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // Helps prevent XSS attacks
      secure: process.env.NODE_ENV === "production", // Only send cookie over HTTPS in production
      maxAge: 3600000, // Set expiration for 1 hour (or adjust as needed)
    },
  })
);

///// Database Connection /////
const db = mysql.createConnection({
  user: "root",
  host: "localhost",
  password: "",
  database: "customerCare",
});
db.query = util.promisify(db.query);
///// Database Connection End /////

///// Check database connection /////
db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err);
    return;
  }
  console.log("Successfully connected to the database.");
  applySchemaUpdates(db, path.join(__dirname, "updateSchema.sql"));
});
///// Check database connection End /////

///// Set up rate limiter middleware /////
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 requests per windowMs
});
app.use("/login", limiter);
///// Set up rate limiter middleware /////

///// Run server /////
// Start HTTP server
const PORT = process.env.PORT || 3001; // Use your desired port
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is listening on ws://localhost:${PORT}`);
});
// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  closeWebSocket(() => {
    console.log("WebSocket server closed");
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
  });
});
///// Run server End /////

// const hashAndSavePassword = async () => {
//   const plainPassword = "Auneeb@786"; // Your plain password
//   const saltRounds = 10;

//   try {
//     const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);

//     // Update the hashed password for the user in the database
//     const sql = "UPDATE users SET password = ? WHERE email = ?";
//     db.query(sql, [hashedPassword, "auneeb.kaleem@gmail.com"], (err, result) => {
//       if (err) {
//         console.error("Error updating password:", err);
//       } else {
//         console.log("Password updated successfully");
//       }
//     });
//   } catch (error) {
//     console.error("Error hashing password:", error);
//   }
// };

// hashAndSavePassword();

///// Schema Versions /////
// Function to check if the database connection is active
function checkDatabaseConnection(db) {
  if (!db.state || db.state === "disconnected") {
    console.error("Database connection error");
    throw new Error("Database is not connected");
  }
}

// Function to remove comments from SQL content
function removeComments(sqlContent) {
  // Remove single-line comments
  const singleLineCommentPattern = /--.*?\n/g;
  sqlContent = sqlContent.replace(singleLineCommentPattern, " ");

  // Remove multi-line comments
  const multiLineCommentPattern = /\/\*[\s\S]*?\*\//g;
  sqlContent = sqlContent.replace(multiLineCommentPattern, " ");

  return sqlContent;
}

// Function to validate SQL content
function isValidSQL(sqlContent) {
  // Simple check for common SQL commands
  const sqlCommands = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
  ];
  return sqlCommands.some((command) =>
    sqlContent.trim().toUpperCase().startsWith(command)
  );
}

// Function to read and execute SQL from a file
function readAndExecuteSQLFile(db, filePath) {
  checkDatabaseConnection(db);

  if (!fs.existsSync(filePath)) {
    console.error(`SQL file not found: ${filePath}`);
    return;
  }

  const sqlContent = fs.readFileSync(filePath, "utf8");
  const cleanedSQLContent = removeComments(sqlContent).trim();

  if (!isValidSQL(cleanedSQLContent)) {
    console.error(`Invalid SQL content in file: ${filePath}`);
    return;
  }

  // Split SQL commands at semicolons to handle them separately
  const sqlStatements = cleanedSQLContent
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);

  sqlStatements.forEach((sql, index) => {
    db.query(sql, (err, results) => {
      if (err) {
        console.error(
          `Error executing SQL statement #${index + 1}: ${sql}`,
          err
        );
        throw err;
      }
    });
  });
}

// Function to generate a version hash based on SQL file content
function generateVersionFromSQL(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`SQL file not found: ${filePath}`);
    return null;
  }

  const sqlContent = fs.readFileSync(filePath, "utf8");

  // Check if the SQL content is empty
  if (!sqlContent.trim()) {
    console.log(`SQL file is empty: ${filePath}`);
    return null; // Return null for empty file
  }

  // Generate a hash (SHA-256) of the SQL file content
  const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");

  // Use the first 10 characters of the hash as the version identifier (you can adjust the length)
  return hash.substring(0, 10);
}

// Function to apply schema updates based on version control
function applySchemaUpdates(db, filePath) {
  checkDatabaseConnection(db);

  const version = generateVersionFromSQL(filePath); // Generate version from SQL content

  if (!version) {
    console.log("No changes found in the database.");
    return;
  }

  // Create the schema_versions table if it doesn't exist
  db.query(
    `
        CREATE TABLE IF NOT EXISTS schema_versions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            version VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    (err, results) => {
      if (err) {
        console.error("Error creating schema_versions table:", err);
        throw err;
      }

      // Check if the current version has already been applied
      db.query(
        "SELECT COUNT(*) AS count FROM schema_versions WHERE version = ?",
        [version],
        (err, results) => {
          if (err) {
            console.error(`Error checking schema version: ${version}`, err);
            throw err;
          }

          const row = results[0];
          if (row.count === 0) {
            console.log(`Applying schema changes for version: ${version}`);
            readAndExecuteSQLFile(db, filePath);

            // Insert the version and timestamp after successfully applying schema updates
            db.query(
              "INSERT INTO schema_versions (version) VALUES (?)",
              [version],
              (err, results) => {
                if (err) {
                  console.error(
                    `Error inserting schema version: ${version}`,
                    err
                  );
                  throw err;
                }
                console.log(
                  `Version '${version}' applied and inserted into schema_versions table.`
                );
              }
            );
          } else {
            console.log(
              `Schema changes for version '${version}' have already been applied.`
            );
          }
        }
      );
    }
  );
}

///// Schema Versions End /////
app.get("/", (req, res) => {
  res.send("Welcome to Product API");
});
///// Jobcard Number Generation /////
app.get("/generate-unique-job-number", (req, res) => {
  const generateRandomNumber = () =>
    Math.floor(10000000 + Math.random() * 90000000).toString();

  const checkUniqueNumber = (jobCardNumber, callback) => {
    const sql = "SELECT 1 FROM jobcard_sc WHERE jobcardNumber = ?";
    db.query(sql, [jobCardNumber], (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }
      callback(results.length === 0);
    });
  };

  const findUniqueJobCardNumber = () => {
    const jobCardNumber = generateRandomNumber();
    checkUniqueNumber(jobCardNumber, (isUnique) => {
      if (isUnique) {
        res.json({ success: true, jobCardNumber });
      } else {
        findUniqueJobCardNumber(); // Retry if not unique
      }
    });
  };

  findUniqueJobCardNumber();
});
///// Jobcard Number Generation End /////

///// Jobcard Form Submission /////
app.post("/submit-jobcard-form", (req, res) => {
  const {
    jobcardNumber,
    customerName,
    customerNumber,
    productSerial,
    productModel,
    productType,
    sealBreak,
    initialProblem,
    quotedCharges,
    d_date,
    serviceCenterId,
  } = req.body;

  // console.log('Received Data:', {
  //     jobcardNumber,
  //     customerName,
  //     customerNumber,
  //     productSerial,
  //     productModel,
  //     productType,
  //     sealBreak,
  //     initialProblem,
  //     quotedCharges,
  //     d_date,
  // });

  // SQL query to insert data
  const sql =
    "INSERT INTO jobcard_sc (jobcardNumber, customerName, customerNumber, productSerial, productModel, productType, sealBreak, initialProblem, quotedCharges, d_date, serviceCenterId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  const values = [
    jobcardNumber,
    customerName,
    customerNumber,
    productSerial,
    productModel,
    productType,
    sealBreak,
    initialProblem,
    quotedCharges,
    d_date,
    serviceCenterId,
  ];

  // Execute the query
  db.query(sql, values, (err, results) => {
    if (err) {
      console.error("Error inserting data:", err);
      return res.status(500).json({
        success: false,
        message: "Error inserting data",
        error: err.message,
      });
    }
    console.log("Data inserted successfully");
    res.json({ success: true, message: "Data submitted successfully" });
  });
});
///// Jobcard Form Submission End /////

///// Get JobCard Data for Print Receipt /////
app.get("/api/jobcard/:jobCardNumber", (req, res) => {
  const jobCardNumber = req.params.jobCardNumber;

  // SQL query with a JOIN to include service_center data
  const sql = `
        SELECT jobcard_sc.*, 
        service_centers.cityName, 
        service_centers.contactNumber, 
        service_centers.userName
        FROM jobcard_sc 
        LEFT JOIN service_centers 
        ON jobcard_sc.serviceCenterId = service_centers.serialNumber 
        WHERE jobcard_sc.jobcardNumber = ?`;

  db.query(sql, [jobCardNumber], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length > 0) {
      // Here, we're sending back the first result which should include cityName, contactNumber, and userName
      res.json({ success: true, data: results[0] });
    } else {
      res.status(404).json({ success: false, message: "Job card not found" });
    }
  });
});
///// Get JobCard Data for Print Receipt End /////

///// Fetch Jobcard Data For Table /////
app.get("/jobcardRecord_fetch", (req, res) => {
  const { serviceCenterId } = req.query;

  if (!serviceCenterId) {
    return res.status(400).send("Service center ID is required");
  }

  const query = "SELECT * FROM jobcard_sc WHERE serviceCenterId = ?";
  db.query(query, [serviceCenterId], (err, results) => {
    if (err) {
      console.error("Error fetching jobcards:", err);
      return res.status(500).send("Server error");
    }
    res.json(results);
  });
});
///// Fetch Jobcard Data For Table End /////

///// Login route /////
app.post(
  "/login",
  (req, res, next) => {
    if (!db.state || db.state === "disconnected") {
      console.error("Database connection error");
      return res
        .status(500)
        .json({ success: false, message: "Database connection error" });
    }
    next();
  },
  (req, res) => {
    const sentloginEmail = req.body.LoginEmail.toLowerCase();
    const sentloginPassword = req.body.LoginPassword;

    // Validate input
    if (!sentloginEmail || !sentloginPassword) {
      console.error("Missing email or password");
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    // First, check in the 'users' table
    const userSql = "SELECT * FROM users WHERE LOWER(email) = ?";
    const values = [sentloginEmail];

    db.query(userSql, values, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      if (results.length > 0) {
        const user = results[0];
        bcrypt.compare(sentloginPassword, user.password, (err, isMatch) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return res
              .status(500)
              .json({ success: false, message: "Server error" });
          }

          if (isMatch) {
            // Generate a token
            const token = jwt.sign(
              { id: user.id, email: user.email },
              process.env.JWT_SECRET,
              { expiresIn: "1h" }
            );

            // Store session variables and respond
            req.session.userId = user.id;
            req.session.userEmail = user.email;
            req.session.userUsername = user.username;
            req.session.userDesignation = user.designation;
            req.session.userServiceCenterId = user.serviceCenterId;
            req.session.userAccess = user.access;

            res.cookie("session_id", req.sessionID, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
            });

            return res.json({
              success: true,
              message: "Login successful",
              token: token,
              user: {
                id: user.id,
                email: user.email,
                username: user.username,
                designation: user.designation,
                serviceCenterId: user.serviceCenterId,
                access: user.access,
                table: "users", // Identify the table
              },
            });
          } else {
            return res.json({
              success: false,
              message: "Invalid Email or Password",
            });
          }
        });
      } else {
        // If not found in 'users', check in 'service_centers'
        const serviceCenterSql =
          "SELECT * FROM service_centers WHERE LOWER(email) = ?";
        db.query(serviceCenterSql, values, (err, results) => {
          if (err) {
            console.error("Database query error:", err);
            return res.status(500).json({
              success: false,
              message: "Database error",
              error: err.message,
            });
          }

          if (results.length > 0) {
            const serviceCenter = results[0];
            bcrypt.compare(
              sentloginPassword,
              serviceCenter.password,
              (err, isMatch) => {
                if (err) {
                  console.error("Error comparing passwords:", err);
                  return res
                    .status(500)
                    .json({ success: false, message: "Server error" });
                }

                if (isMatch) {
                  // Generate a token
                  const token = jwt.sign(
                    {
                      id: serviceCenter.serialNumber,
                      email: serviceCenter.email,
                    },
                    process.env.JWT_SECRET,
                    { expiresIn: "1h" }
                  );

                  const userAccess = "serviceCenter";
                  // Store session variables and respond
                  req.session.userEmail = serviceCenter.email;
                  req.session.userUsername = serviceCenter.userName;
                  req.session.userDesignation = serviceCenter.designation;
                  req.session.userServiceCenterId = serviceCenter.serialNumber;
                  req.session.userAccess = userAccess;

                  res.cookie("session_id", req.sessionID, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                  });

                  return res.json({
                    success: true,
                    message: "Login successful",
                    token: token,
                    user: {
                      id: serviceCenter.serialNumber,
                      email: serviceCenter.email,
                      username: serviceCenter.userName,
                      access: userAccess,
                      designation: serviceCenter.designation,
                      serviceCenterId: serviceCenter.serialNumber,
                      table: "service_centers", // Identify the table
                    },
                  });
                } else {
                  return res.json({
                    success: false,
                    message: "Invalid Email or Password",
                  });
                }
              }
            );
          } else {
            return res.json({
              success: false,
              message: "Invalid Email or Password",
            });
          }
        });
      }
    });
  }
);
///// Login route End /////

///// Middleware to verify JWT /////
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Get the token from the header

  if (!token) {
    return res.status(401).json({ success: false, message: "Token missing" });
  }

  // Verify token
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res
        .status(403)
        .json({ success: false, message: "Token is not valid or expired" });
    }
    req.userId = user.id; // Attach user ID to request for further processing
    next(); // Proceed to the next middleware or route handler
  });
};
///// Middleware End /////

///// New route to fetch user data using token /////
app.get("/api/user", authenticateToken, (req, res) => {
  const userId = req.userId;

  const sql =
    "SELECT id, email, username, designation, serviceCenterId, access FROM users WHERE id = ?";
  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length > 0) {
      const user = results[0];
      return res.json({ success: true, data: user });
    } else {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
  });
});
///// User data route End /////

////////// Users Page //////////
// Get users with specific access
app.get("/api/users/fetch", (req, res) => {
  const { access, serviceCenterId } = req.query; // Get both 'access' and 'serviceCenterId' from query parameters

  // Validate input
  if (!access || !serviceCenterId) {
    return res.status(400).send("Access and serviceCenterId are required");
  }

  // Use placeholders for SQL injection protection
  const sqlQuery =
    "SELECT * FROM users WHERE access IN (?) AND serviceCenterId = ?";
  db.query(sqlQuery, [access, serviceCenterId], (err, results) => {
    if (err) {
      console.error("Error fetching users:", err);
      res.status(500).send("Server error");
      return;
    }
    res.json(results);
  });
});

// Update a user by ID
app.put("/api/users/update/:id", async (req, res) => {
  const { id } = req.params;
  const { username, email, password } = req.body;

  try {
    const updates = { username, email };

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.password = hashedPassword;
    }

    await db.query("UPDATE users SET ? WHERE id = ?", [updates, id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).send("Error updating user");
  }
});

// Delete a user by ID
app.delete("/api/users/delete/:id", (req, res) => {
  const { id } = req.params;

  const sqlDelete = "DELETE FROM users WHERE id = ?";
  db.query(sqlDelete, [id], (err, result) => {
    if (err) {
      console.error("Error deleting user:", err);
      res.status(500).send("Server error");
      return;
    }
    res.send("User deleted successfully");
  });
});

// Revoke a user's access by updating their password to a random value
app.put("/api/users/revoke/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Generate a random password
    const randomPassword = crypto.randomBytes(8).toString("hex");
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    // Get the current designation of the user before revoking
    const sqlGetDesignation = "SELECT designation FROM users WHERE id = ?";
    db.query(sqlGetDesignation, [id], async (err, result) => {
      if (err) {
        console.error("Error fetching user designation:", err);
        res.status(500).send("Error fetching user designation");
        return;
      }

      if (result.length === 0) {
        return res.status(404).send("User not found");
      }

      const currentDesignation = result[0].designation;

      // Update the designation by appending (revoked) to the existing designation value
      const updatedDesignation = `${currentDesignation} (revoked)`;

      // Update the user's designation and password in a single query
      const sqlUpdate =
        "UPDATE users SET designation = ?, password = ? WHERE id = ?";
      db.query(
        sqlUpdate,
        [updatedDesignation, hashedPassword, id],
        (err, updateResult) => {
          if (err) {
            console.error("Error updating designation and password:", err);
            res.status(500).send("Error revoking access and updating password");
            return;
          }

          res.status(200).send({
            message: "Access revoked and password updated successfully",
            updatedDesignation,
            randomPassword,
          });
        }
      );
    });
  } catch (error) {
    console.error("Error revoking access:", error);
    res.status(500).send("Error revoking access");
  }
});

app.put("/api/users/restore/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Get the current username and designation of the user before restoring access
    const sqlGetUser = "SELECT username, designation FROM users WHERE id = ?";
    db.query(sqlGetUser, [id], async (err, result) => {
      if (err) {
        console.error("Error fetching user details:", err);
        res.status(500).send("Error fetching user details");
        return;
      }

      if (result.length === 0) {
        return res.status(404).send("User not found");
      }

      const { username, designation } = result[0];

      // Split the username to get the first name and convert it to uppercase
      const firstName = username.split(" ")[0].toUpperCase(); // Convert first name to uppercase

      // Create the new password using the first name in uppercase
      const newPassword = `${firstName}123#`;

      // Remove "(revoked)" from the designation, if it exists
      const updatedDesignation = designation.replace(" (revoked)", "");

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update the user's password and designation
      const sqlUpdate =
        "UPDATE users SET password = ?, designation = ? WHERE id = ?";
      db.query(
        sqlUpdate,
        [hashedPassword, updatedDesignation, id],
        (err, updateResult) => {
          if (err) {
            console.error("Error restoring user access:", err);
            res.status(500).send("Error restoring user access");
            return;
          }

          res.status(200).send({
            message: "User access restored successfully",
            updatedDesignation, // Send back the updated designation
            newPassword, // Optional: Send back the new password (for admin use)
          });
        }
      );
    });
  } catch (error) {
    console.error("Error restoring access:", error);
    res.status(500).send("Error restoring access");
  }
});

app.post("/api/users/create", async (req, res) => {
  const { email, username, password, access, designation, serviceCenterId } =
    req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sqlInsert =
      "INSERT INTO users (email, username, password, access, designation, serviceCenterId) VALUES (?, ?, ?, ?, ?, ?)";

    db.query(
      sqlInsert,
      [email, username, hashedPassword, access, designation, serviceCenterId],
      (err, result) => {
        if (err) {
          console.error("Error inserting user:", err);
          res.status(500).send("Error adding user.");
          return;
        }

        // Send back the newly inserted user including the generated ID
        const newUser = {
          id: result.insertId, // Get the auto-generated ID
          email,
          username,
          access,
          designation,
          serviceCenterId,
        };

        res.status(201).json(newUser); // Respond with the full user object
      }
    );
  } catch (error) {
    console.error("Error hashing password:", error);
    res.status(500).send("Error adding user.");
  }
});
////////// Users Page End //////////
////////// Warehouse Page //////////
// API to fetch parts
app.get("/api/fetch/parts_warehouse", (req, res) => {
  const query = "SELECT * FROM parts_wh";
  db.query(query, (err, results) => {
    if (err) {
      res.status(500).json({ error: "Failed to fetch records" });
    } else {
      res.json(results);
    }
  });
});

// API route to handle part creation
app.post("/api/add-part_warehouse", (req, res) => {
  const { part_name, batch_no, category, quantity } = req.body;

  if (!part_name || !batch_no || !category || !quantity) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const query = `
    INSERT INTO parts_wh (part_name, batch_no, category, quantity)
    VALUES (?, ?, ?, ?)
  `;

  db.query(query, [part_name, batch_no, category, quantity], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ message: "Failed to add part" });
    }

    const partId = result.insertId; // Get the auto-incremented part_id
    const newPart = {
      part_id: partId,
      part_name,
      batch_no,
      category,
      quantity,
    };

    res.json(newPart); // Return the inserted record with the new part_id
  });
});

app.post("/api/updatePart_warehouse", async (req, res) => {
  const { part_id, part_name, batch_no, category, quantity } = req.body;
  try {
    await db.query(
      "UPDATE parts_wh SET part_name = ?, batch_no = ?, category = ?, quantity = ? WHERE part_id = ?",
      [part_name, batch_no, category, quantity, part_id]
    );
    res.status(200).json({ message: "Part updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update part" });
  }
});

// POST: Send parts to service center
app.post("/api/send/parts_sc", async (req, res) => {
  const connection = db;

  connection.beginTransaction(async (err) => {
    if (err) {
      return res.status(500).json({ error: "Transaction start failed" });
    }

    try {
      const { serviceCenterId, biltyNo, parts } = req.body;

      if (
        !serviceCenterId ||
        !biltyNo ||
        !Array.isArray(parts) ||
        parts.length === 0
      ) {
        return res.status(400).json({
          error: "Invalid input. Please provide all required fields.",
        });
      }

      let dateTransferred;

      for (const part of parts) {
        if (
          !part.part_id ||
          !part.batch_no ||
          typeof part.quantity !== "number" ||
          part.quantity <= 0
        ) {
          return res.status(400).json({ error: "Invalid part details." });
        }

        // // Insert into pending_transactions
        // const insertPendingQuery = `
        //     INSERT INTO pending_transactions (serviceCenterId, wh_part_id, batch_no, quantity, bilty_no, status, date_sent)
        //     VALUES (?, ?, ?, ?, ?, 'Pending', NOW())
        // `;
        // const insertPendingValues = [
        //   serviceCenterId,
        //   part.part_id,
        //   part.batch_no,
        //   part.quantity,
        //   biltyNo,
        // ];
        // await connection.query(
        //   insertPendingQuery,
        //   insertPendingValues,
        //   (err) => {
        //     if (err) {
        //       return connection.rollback(() => {
        //         console.error(
        //           "Error inserting into pending_transactions:",
        //           err
        //         );
        //         return res
        //           .status(500)
        //           .json({ error: "Failed to insert transaction." });
        //       });
        //     }
        //   }
        // );

        // Insert into transfer_log_wh
        const insertTransferLogQuery = `
            INSERT INTO transfer_log_wh (wh_part_id, batch_no, serviceCenterId, quantity, date_transferred, status, bilty_no)
            VALUES (?, ?, ?, ?, NOW(), 'Sent', ?)
        `;
        const insertTransferLogValues = [
          part.part_id,
          part.batch_no,
          serviceCenterId,
          part.quantity,
          biltyNo,
        ];
        await connection.query(
          insertTransferLogQuery,
          insertTransferLogValues,
          (err) => {
            if (err) {
              return connection.rollback(() => {
                console.error("Error inserting into transfer_log_wh:", err);
                return res
                  .status(500)
                  .json({ error: "Failed to insert transfer log." });
              });
            }
          }
        );
        dateTransferred = new Date();
        // Update parts_wh
        const updatePartsWhQuery = `
            UPDATE parts_wh
            SET quantity = quantity - ?
            WHERE part_id = ? AND batch_no = ?
        `;
        const updatePartsWhValues = [
          part.quantity,
          part.part_id,
          part.batch_no,
        ];
        await connection.query(
          updatePartsWhQuery,
          updatePartsWhValues,
          (err) => {
            if (err) {
              return connection.rollback(() => {
                console.error("Error updating parts_wh:", err);
                return res
                  .status(500)
                  .json({ error: "Failed to update parts_wh." });
              });
            }
          }
        );
      }

      connection.commit((err) => {
        if (err) {
          return connection.rollback(() => {
            console.error("Error committing transaction:", err);
            return res
              .status(500)
              .json({ error: "Failed to commit transaction." });
          });
        }

        // Notify via WebSocket
        const message = JSON.stringify({
          type: "parts_sent",
          serviceCenterId,
          biltyNo,
          dateTransferred,
        });
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(message);
            } catch (wsError) {
              console.error("WebSocket error:", wsError);
            }
          }
        });

        res
          .status(200)
          .json({ message: "Parts sent successfully, awaiting confirmation." });
      });
    } catch (error) {
      connection.rollback(() => {
        console.error("Error processing request:", error);
        res
          .status(500)
          .json({ error: "An error occurred while processing the request." });
      });
    }
  });
});

app.get("/api/fetch/warehouse_transaction_logs", async (req, res) => {
  try {
    const query = `
          SELECT 
              tl.transfer_id,
              tl.bilty_no, 
              tl.serviceCenterId, 
              sc.cityName, -- Join to get cityName
              tl.date_transferred, 
              tl.status, 
              GROUP_CONCAT(
                  JSON_OBJECT(
                      'part_id', pw.part_id,
                      'part_name', pw.part_name, -- Join to get part_name
                      'category', pw.category, -- Join to get category
                      'batch_no', tl.batch_no,
                      'quantity', tl.quantity
                  )
              ) AS parts_details
          FROM transfer_log_wh tl
          JOIN service_centers sc ON tl.serviceCenterId = sc.serialNumber -- Join with service_centers
          JOIN parts_wh pw ON tl.wh_part_id = pw.part_id -- Join with parts_wh
          GROUP BY tl.bilty_no, tl.serviceCenterId, tl.date_transferred, tl.status
          ORDER BY tl.date_transferred DESC;
      `;

    db.query(query, (err, results) => {
      if (err) {
        console.error("Error fetching transaction logs:", err);
        return res
          .status(500)
          .json({ error: "Failed to fetch transaction logs" });
      }

      // Parse JSON fields for front-end compatibility
      const parsedResults = results.map((record) => ({
        ...record,
        parts_details: record.parts_details
          ? JSON.parse(`[${record.parts_details}]`)
          : [],
      }));

      res.status(200).json(parsedResults);
    });
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching transfer logs" });
  }
});
////////// Warehouse Page End //////////

////////// Service Center Notifications //////////
app.get("/api/sc_notifications_fetch", (req, res) => {
  const { serviceCenterId } = req.query; // Retrieve serviceCenterId from query params

  if (!serviceCenterId) {
    return res.status(400).json({ error: "Service Center ID is required" });
  }

  try {
    const query = `
    SELECT 
        tl.transfer_id AS transaction_id,
        tl.bilty_no,
        tl.serviceCenterId,
        sc.cityName,
        DATE_FORMAT(tl.date_transferred, '%d/%m/%Y, %H:%i:%s') AS formatted_date_sent,
        tl.status,
        GROUP_CONCAT(
            JSON_OBJECT(
                'part_id', pw.part_id,
                'part_name', pw.part_name,
                'category', pw.category,
                'batch_no', tl.batch_no,
                'quantity', tl.quantity
            )
        ) AS parts_details
    FROM transfer_log_wh tl
    JOIN service_centers sc ON tl.serviceCenterId = sc.serialNumber
    JOIN parts_wh pw ON tl.wh_part_id = pw.part_id
    WHERE tl.status = 'Sent' AND tl.serviceCenterId = ?
    GROUP BY tl.bilty_no, tl.serviceCenterId, tl.date_transferred, tl.status
    ORDER BY tl.date_transferred DESC;
    `;

    db.query(query, [serviceCenterId], (err, results) => {
      if (err) {
        console.error("Error fetching notifications:", err);
        return res
          .status(500)
          .json({ message: "Error fetching notifications" });
      }

      // Parse JSON fields for front-end compatibility
      const parsedResults = results.map((record) => ({
        ...record,
        parts_details: JSON.parse(`[${record.parts_details}]`),
      }));

      res.status(200).json(parsedResults);
    });
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching notifications" });
  }
});

// API to insert parts for service center
app.post("/api/insert_parts_sc", async (req, res) => {
  const { serviceCenterId, bilty_no, parts_details } = req.body;

  if (
    !serviceCenterId ||
    !bilty_no ||
    !parts_details ||
    !Array.isArray(parts_details)
  ) {
    return res.status(400).json({ error: "Invalid request payload" });
  }

  try {
    // Start a transaction
    await db.beginTransaction();

    // Insert parts into the service center's parts table
    for (const part of parts_details) {
      const { part_id, batch_no, quantity } = part;
      await new Promise((resolve, reject) => {
        db.query(
          `
          INSERT INTO parts_sc (serviceCenterId, wh_part_id, batch_no, quantity, bilty_no)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
              quantity = quantity + VALUES(quantity)`,
          [serviceCenterId, part_id, batch_no, quantity, bilty_no],
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
      });
    }

    // Update the status in transfer_log_wh table
    await new Promise((resolve, reject) => {
      db.query(
        `
        UPDATE transfer_log_wh
        SET status = 'Delivered'
        WHERE bilty_no = ? AND status = 'Sent'`,
        [bilty_no],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    // Commit the transaction
    await new Promise((resolve, reject) => {
      db.commit((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    res.status(200).json({
      message: "Parts successfully transferred and status updated to Delivered",
    });
  } catch (error) {
    console.error("Error inserting parts:", error);

    // Rollback transaction in case of an error
    await new Promise((resolve, reject) => {
      db.rollback((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    res.status(500).json({ error: "Internal server error" });
  }
});

////////// Service Center Notifications End //////////

////////// Service Center Parts Fetch //////////
// Fetch Service Center parts
app.get("/api/fetch/serviceCenter-parts/:serviceCenterId", async (req, res) => {
  const { serviceCenterId } = req.params;

  const query = `
      SELECT pw.part_name, pw.batch_no, pw.category, ps.part_id, ps.quantity
      FROM parts_sc ps
      JOIN parts_wh pw ON ps.wh_part_id = pw.part_id
      WHERE ps.serviceCenterId = ?
  `;

  db.query(query, [serviceCenterId], (error, results) => {
    if (error) {
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});
////////// Service Center Parts Fetch //////////

////////// Service Center Lab Parts //////////
// Fetch parts for a specific service center
app.get("/api/fetch/lab_parts_sc", async (req, res) => {
  const { serviceCenterId } = req.query; // Get serviceCenterId from query parameters

  if (!serviceCenterId) {
    return res.status(400).json({ error: "Service Center ID is required" });
  }

  const query = `
      SELECT ps.part_id, pw.part_name, ps.wh_part_id, pw.category, ps.batch_no, ps.quantity
      FROM parts_sc ps
      JOIN parts_wh pw ON ps.wh_part_id = pw.part_id
      WHERE ps.serviceCenterId = ?
  `;

  db.query(query, [serviceCenterId], (error, results) => {
    if (error) {
      console.error("Error fetching parts:", error);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results); // Return the fetched parts
  });
});

// Add parts to parts_used_lab table:
app.post("/api/add/parts_used_lab", async (req, res) => {
  const { parts } = req.body; // Expecting an array of parts

  try {
    // Start a transaction
    await db.beginTransaction();

    // Process each part
    for (const part of parts) {
      // Check if the part already exists in parts_used_lab
      const existingPartQuery = `
              SELECT * FROM parts_used_lab 
              WHERE wh_part_id = ? AND jobcard_serial_no = ?
          `;
      const [existingPart] = await new Promise((resolve, reject) => {
        db.query(
          existingPartQuery,
          [part.wh_part_id, part.jobcard_serial_no],
          (error, results) => {
            if (error) return reject(error);
            resolve(results);
          }
        );
      });

      if (existingPart) {
        // If the part exists, update the existing record
        const updateQuery = `
                  UPDATE parts_used_lab 
                  SET quantity = ? 
                  WHERE wh_part_id = ? AND jobcard_serial_no = ?
              `;
        await new Promise((resolve, reject) => {
          db.query(
            updateQuery,
            [part.quantity, part.wh_part_id, part.jobcard_serial_no],
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
        });

        // Check if the new quantity is zero and delete if it is
        if (part.quantity === 0) {
          const deleteQuery = `
                    DELETE FROM parts_used_lab 
                    WHERE wh_part_id = ? AND jobcard_serial_no = ?
                `;
          await new Promise((resolve, reject) => {
            db.query(
              deleteQuery,
              [part.wh_part_id, part.jobcard_serial_no],
              (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }
            );
          });
        }
      } else {
        // If the part does not exist, insert a new record
        const insertQuery = `
                  INSERT INTO parts_used_lab (wh_part_id, jobcard_serial_no, status, solved_on, solved_by, delivered_on, quantity) 
                  VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
              `;
        await new Promise((resolve, reject) => {
          db.query(
            insertQuery,
            [
              part.wh_part_id,
              part.jobcard_serial_no,
              part.status,
              part.solved_by,
              part.delivered_on,
              part.quantity,
            ],
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
        });
      }
    }

    // Update quantities in parts_sc based on quantityChange
    const updateQueries = parts.map((part) => {
      return new Promise((resolve, reject) => {
        db.query(
          "UPDATE parts_sc SET quantity = quantity - ? WHERE wh_part_id = ?",
          [part.quantityChange, part.wh_part_id], // Use the quantityChange
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
      });
    });

    // Execute all update queries
    await Promise.all(updateQueries);

    // Commit the transaction
    await db.commit();

    res.status(200).json({ message: "Parts added/updated successfully" });
  } catch (error) {
    console.error("Error adding parts:", error);
    await db.rollback();
    res.status(500).json({ message: "Error adding parts" });
  }
});

// API endpoint to fetch existing parts used for a job card
app.get("/api/fetch/existing_parts_used_lab", (req, res) => {
  const jobcardSerialNo = req.query.jobcardSerialNo; // Get the jobcardSerialNo from query parameters

  // SQL query to fetch existing parts used for the specified job card
  const query = `
      SELECT 
          p.wh_part_id, 
          p.quantity 
      FROM 
          parts_used_lab p 
      WHERE 
          p.jobcard_serial_no = ?`;

  db.query(query, [jobcardSerialNo], (error, results) => {
    if (error) {
      console.error("Error fetching existing parts:", error);
      return res.status(500).json({ message: "Error fetching existing parts" });
    }

    // Send the results back to the client
    res.status(200).json(results);
  });
});

app.get("/api/fetch/usedPartsData", (req, res) => {
  const { jobcard_serial_no } = req.query; // Get jobcard_serial_no from query parameters

  if (!jobcard_serial_no) {
    return res.status(400).json({ error: "jobcard_serial_no is required" });
  }

  // SQL query to fetch the required data
  const sql = `
      SELECT 
          pul.part_used_id,
          pw.part_name,
          pw.batch_no,
          pw.category,
          pul.quantity
      FROM 
          parts_used_lab pul
      JOIN 
          parts_wh pw ON pul.wh_part_id = pw.part_id
      WHERE 
          pul.jobcard_serial_no = ?
  `;

  // Execute the query
  db.query(sql, [jobcard_serial_no], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    // Send the results back to the client
    res.json(results);
  });
});
////////// Service Center Lab Parts //////////

////////// Factory Functionality //////////
app.post("/api/upload-parts_factory_wh", async (req, res) => {
  const { parts, container_no, remarks } = req.body;

  // Validate that container_no is provided
  if (!container_no) {
    return res.status(400).json({ message: "Container number is required" });
  }

  if (!parts || parts.length === 0) {
    return res.status(400).json({ message: "No parts provided" });
  }

  try {
    // Check if the container already exists
    const result = await db.query(
      "SELECT * FROM containers WHERE container_no = ?",
      [container_no]
    );

    // If container doesn't exist, insert it
    let container_id;
    if (result.length === 0) {
      const insertResult = await db.query(
        "INSERT INTO containers (container_no, remarks, date) VALUES (?, ?, NOW())",
        [container_no, remarks || null]
      );
      container_id = insertResult.insertId; // Get the inserted container's ID
    } else {
      container_id = result[0].container_id; // Use the existing container's ID
    }

    // Insert or update parts in the parts_factory table
    for (const part of parts) {
      // Ensure quantity is a number (remove commas and convert to float)
      part.quantity = parseFloat(part.quantity.replace(/,/g, ""));

      // Trim batch_no to remove extra spaces or hidden characters
      const batch_no = part.batch_no.trim();

      // Insert into parts_factory table or update the quantity if the batch_no already exists
      await db.query(
        `INSERT INTO parts_factory (batch_no, part_name, quantity) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [batch_no, part.part_name, part.quantity]
      );

      // Insert into container_parts table (always done regardless of update or insert)
      await db.query(
        "INSERT INTO container_parts (batch_no, part_name, quantity, container_id) VALUES (?, ?, ?, ?)",
        [batch_no, part.part_name, part.quantity, container_id]
      );
    }

    res.status(200).json({ message: "Parts uploaded successfully" });
  } catch (error) {
    console.error("Error in upload:", error);
    res.status(500).json({ message: "Error uploading parts" });
  }
});

// API endpoint Fetch Container and its associated parts
app.get("/api/fetch/containers-with-parts", (req, res) => {
  const setGroupConcatLimitQuery =
    "SET SESSION group_concat_max_len = 1000000;";
  const selectQuery = `
    SELECT 
        c.container_id,
        c.container_no,
        c.remarks,
        c.date,
        GROUP_CONCAT(
            JSON_OBJECT(
                'part_id', IFNULL(cp.part_id, '0'),
                'batch_no', IFNULL(cp.batch_no, ''),
                'part_name', IFNULL(cp.part_name, 'N/A'),
                'quantity', IFNULL(cp.quantity, '0')
            )
        ) AS parts_details
    FROM containers c
    LEFT JOIN container_parts cp ON c.container_id = cp.container_id
    GROUP BY c.container_id, c.container_no, c.remarks, c.date
  `;

  try {
    // Set the group_concat_max_len session variable for large results
    db.query(setGroupConcatLimitQuery, (err) => {
      if (err) {
        console.error("Error setting group_concat_max_len:", err);
        return res
          .status(500)
          .json({ message: "Error setting session variables" });
      }

      // Query to fetch the data
      db.query(selectQuery, (err, results) => {
        if (err) {
          console.error("Error fetching containers with parts:", err);
          return res
            .status(500)
            .json({ message: "Error fetching containers with parts" });
        }

        // Parse the parts details as JSON
        const parsedResults = results.map((row) => {
          return {
            ...row,
            parts_details: row.parts_details
              ? JSON.parse(`[${row.parts_details}]`)
              : [],
          };
        });

        res.status(200).json(parsedResults);
      });
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({
      error: "An error occurred while fetching containers with parts",
    });
  }
});

// API endpoint Fetch Container and its associated parts
app.get("/api/fetch/orders-with-parts", (req, res) => {
  const setGroupConcatLimitQuery =
    "SET SESSION group_concat_max_len = 1000000;";
  const selectQuery = `
    SELECT 
        odr.order_id,
        odr.order_no,
        odr.date,
        GROUP_CONCAT(
            JSON_OBJECT(
                'part_id', IFNULL(opr.part_id, '0'),
                'batch_no', IFNULL(opr.batch_no, ''),
                'part_name', IFNULL(opr.part_name, 'N/A'),
                'quantity', IFNULL(opr.quantity, '0')
            )
        ) AS parts_details
    FROM orders_record odr
    LEFT JOIN order_parts_record opr ON odr.order_id = opr.order_id
    GROUP BY odr.order_id, odr.order_no, odr.date
  `;

  try {
    // Set the group_concat_max_len session variable for large results
    db.query(setGroupConcatLimitQuery, (err) => {
      if (err) {
        console.error("Error setting group_concat_max_len:", err);
        return res
          .status(500)
          .json({ message: "Error setting session variables" });
      }

      // Query to fetch the data
      db.query(selectQuery, (err, results) => {
        if (err) {
          console.error("Error fetching orders with parts:", err);
          return res
            .status(500)
            .json({ message: "Error fetching orders with parts" });
        }

        // Parse the parts details as JSON
        const parsedResults = results.map((row) => {
          return {
            ...row,
            parts_details: row.parts_details
              ? JSON.parse(`[${row.parts_details}]`)
              : [],
          };
        });

        res.status(200).json(parsedResults);
      });
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching orders with parts" });
  }
});

// API to fetch parts
app.get("/api/fetch/parts_factory", (req, res) => {
  const query = "SELECT * FROM parts_factory";
  db.query(query, (err, results) => {
    if (err) {
      res.status(500).json({ error: "Failed to fetch records" });
    } else {
      res.json(results);
    }
  });
});

// API route to handle part creation
app.post("/api/add-part_factory", (req, res) => {
  const { part_name, batch_no, quantity } = req.body;

  if (!part_name || !batch_no || !quantity) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const query = `
    INSERT INTO parts_factory (part_name, batch_no, quantity)
    VALUES (?, ?, ?, ?)
  `;

  db.query(query, [part_name, batch_no, quantity], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ message: "Failed to add part" });
    }

    const partId = result.insertId; // Get the auto-incremented part_id
    const newPart = {
      part_id: partId,
      part_name,
      batch_no,
      quantity,
    };

    res.json(newPart); // Return the inserted record with the new part_id
  });
});

app.post("/api/updatePart_factory", async (req, res) => {
  const { part_id, part_name, batch_no, quantity } = req.body;
  try {
    await db.query(
      "UPDATE parts_factory SET part_name = ?, batch_no = ?, quantity = ? WHERE part_id = ?",
      [part_name, batch_no, quantity, part_id]
    );
    res.status(200).json({ message: "Part updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update part" });
  }
});

// POST: Send parts to Production Line
app.post("/api/send/prod_line", async (req, res) => {
  const connection = db;

  connection.beginTransaction(async (err) => {
    if (err) {
      console.error("Transaction start failed:", err);
      return res.status(500).json({ error: "Transaction start failed" });
    }

    try {
      const { orderNumber, parts, remarks } = req.body;

      if (!orderNumber || !Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({
          error: "Invalid input. Please provide an order number and parts.",
        });
      }

      // Step 1: Insert order number and current date into the orders_record table
      const currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
      const insertOrderQuery = `
        INSERT INTO orders_record (order_no, date)
        VALUES (?, ?)
      `;
      const orderResult = await connection.query(insertOrderQuery, [
        orderNumber,
        currentDate,
      ]);

      const orderId = orderResult.insertId; // Get the generated order_id

      // Step 2: Insert parts into order_parts_record with the order_id
      for (const part of parts) {
        if (
          !part.batch_no ||
          !part.part_name ||
          typeof part.quantity !== "number" ||
          part.quantity <= 0
        ) {
          return res.status(400).json({ error: "Invalid part details." });
        }

        const insertProductionLineRecordQuery = `
          INSERT INTO order_parts_record (batch_no, part_name, quantity, order_id)
          VALUES (?, ?, ?, ?)
        `;
        await connection.query(insertProductionLineRecordQuery, [
          part.batch_no,
          part.part_name,
          part.quantity,
          orderId, // Use the order_id from orders_record
        ]);
      }

      // Step 3: Add remarks to prod_line_requests
      if (remarks) {
        const updateRemarksQuery = `
          UPDATE prod_line_requests
          SET remarks = ?
          WHERE order_number = ?
        `;
        await connection.query(updateRemarksQuery, [remarks, orderNumber]);
      }

      // Step 4: Update status in prod_line_requests
      const updateProdLineStatusQuery = `
        UPDATE prod_line_requests
        SET status = 'sent'
        WHERE order_number = ? AND status = 'pending'
      `;
      await connection.query(updateProdLineStatusQuery, [orderNumber]);

      // Step 5: Update requested_parts status to 'delivered'
      const findRequestIdQuery = `
        SELECT request_id
        FROM prod_line_requests
        WHERE order_number = ?
      `;
      const requestIdResult = await connection.query(findRequestIdQuery, [
        orderNumber,
      ]);

      if (requestIdResult.length > 0) {
        const requestId = requestIdResult[0].request_id;

        const updateRequestedPartsQuery = `
          UPDATE requested_parts
          SET status = 'sent'
          WHERE request_id = ? AND status = 'pending'
        `;
        await connection.query(updateRequestedPartsQuery, [requestId]);
      }

      // Notify via WebSocket
      const dateSent = new Date();
      const message = JSON.stringify({
        type: "parts_sent_to_prod_line",
        order_id: orderId,
        order_no: orderNumber,
        date_sent: dateSent,
      });

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (wsError) {
            console.error("WebSocket error:", wsError);
          }
        }
      });

      // Commit the transaction
      connection.commit((err) => {
        if (err) {
          return connection.rollback(() => {
            console.error("Error committing transaction:", err);
            return res
              .status(500)
              .json({ error: "Failed to commit transaction." });
          });
        }

        res
          .status(200)
          .json({ message: "Parts successfully sent to production line." });
      });
    } catch (error) {
      connection.rollback(() => {
        console.error("Error processing request:", error);
        res
          .status(500)
          .json({ error: "An error occurred while processing the request." });
      });
    }
  });
});

app.get("/api/notifications/production-line", async (req, res) => {
  try {
    const query = `
      SELECT order_id, order_no, date
      FROM orders_record
      WHERE status = 'pending'
    `;
    const results = await db.query(query);

    res.status(200).json({
      notifications: results.map((row) => ({
        order_id: row.order_id,
        order_no: row.order_no,
        date: row.date,
      })),
    });
  } catch (error) {
    console.error("Error fetching production line notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

app.post("/api/confirm_delivery", async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Order ID is required." });
  }

  try {
    // Fetch order details from orders_record and order_parts_record
    const orderQuery = `
      SELECT orr.order_no, opr.batch_no, opr.part_name, opr.quantity 
      FROM orders_record orr
      JOIN order_parts_record opr ON orr.order_id = opr.order_id
      WHERE orr.order_id = ?
    `;
    const orderDetails = await db.query(orderQuery, [orderId]);

    if (orderDetails.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Process each part in the order
    for (const part of orderDetails) {
      const { batch_no, part_name, quantity } = part;

      // Check if the batch already exists in the production_line table
      const checkExistingPartQuery = `
        SELECT * FROM production_line WHERE batch_no = ?
      `;
      const existingPart = await db.query(checkExistingPartQuery, [batch_no]);

      if (existingPart.length > 0) {
        // Update quantity in production_line
        const updateProductionLineQuery = `
          UPDATE production_line
          SET quantity = quantity + ?
          WHERE batch_no = ?
        `;
        await db.query(updateProductionLineQuery, [quantity, batch_no]);
      } else {
        // Insert new part in production_line
        const insertProductionLineQuery = `
          INSERT INTO production_line (batch_no, part_name, quantity)
          VALUES (?, ?, ?)
        `;
        await db.query(insertProductionLineQuery, [
          batch_no,
          part_name,
          quantity,
        ]);
      }
    }

    // Update status of orders_record from 'pending' to 'delivered'
    const updateOrderStatusQuery = `
        UPDATE orders_record
        SET status = 'delivered'
        WHERE order_id = ?
      `;
    await db.query(updateOrderStatusQuery, [orderId]);

    // Update status in prod_line_requests from 'sent' to 'delivered'
    const updateProdLineRequestsQuery = `
      UPDATE prod_line_requests
      SET status = 'delivered'
      WHERE order_number = (
        SELECT order_no FROM orders_record WHERE order_id = ?
      ) AND status = 'sent'
    `;
    await db.query(updateProdLineRequestsQuery, [orderId]);

    // Update status in requested_parts from 'sent' to 'delivered'
    const findRequestIdQuery = `
      SELECT request_id
      FROM prod_line_requests
      WHERE order_number = (
        SELECT order_no FROM orders_record WHERE order_id = ?
      )
    `;
    const requestIdResult = await db.query(findRequestIdQuery, [orderId]);

    if (requestIdResult.length > 0) {
      const requestId = requestIdResult[0].request_id;

      const updateRequestedPartsQuery = `
        UPDATE requested_parts
        SET status = 'delivered'
        WHERE request_id = ? AND status = 'sent'
      `;
      await db.query(updateRequestedPartsQuery, [requestId]);
    }

    res
      .status(200)
      .json({ message: "Delivery confirmed and production line updated." });
  } catch (error) {
    console.error("Error confirming delivery:", error);
    res
      .status(500)
      .json({ error: "An error occurred while confirming delivery." });
  }
});

// app.get("/api/fetch/warehouse_transaction_logs", async (req, res) => {
//   try {
//     const query = `
//           SELECT
//               tl.transfer_id,
//               tl.bilty_no,
//               tl.serviceCenterId,
//               sc.cityName, -- Join to get cityName
//               tl.date_transferred,
//               tl.status,
//               GROUP_CONCAT(
//                   JSON_OBJECT(
//                       'part_id', pw.part_id,
//                       'part_name', pw.part_name, -- Join to get part_name
//                       'category', pw.category, -- Join to get category
//                       'batch_no', tl.batch_no,
//                       'quantity', tl.quantity
//                   )
//               ) AS parts_details
//           FROM transfer_log_wh tl
//           JOIN service_centers sc ON tl.serviceCenterId = sc.serialNumber -- Join with service_centers
//           JOIN parts_wh pw ON tl.wh_part_id = pw.part_id -- Join with parts_wh
//           GROUP BY tl.bilty_no, tl.serviceCenterId, tl.date_transferred, tl.status
//           ORDER BY tl.date_transferred DESC;
//       `;

//     db.query(query, (err, results) => {
//       if (err) {
//         console.error("Error fetching transaction logs:", err);
//         return res
//           .status(500)
//           .json({ error: "Failed to fetch transaction logs" });
//       }

//       // Parse JSON fields for front-end compatibility
//       const parsedResults = results.map((record) => ({
//         ...record,
//         parts_details: record.parts_details
//           ? JSON.parse(`[${record.parts_details}]`)
//           : [],
//       }));

//       res.status(200).json(parsedResults);
//     });
//   } catch (error) {
//     console.error("Error:", error);
//     res
//       .status(500)
//       .json({ error: "An error occurred while fetching transfer logs" });
//   }
// });

app.get("/api/fetch-order_parts_records", async (req, res) => {
  const sql = `
    SELECT opr.part_id, opr.batch_no, opr.part_name, opr.quantity, orr.order_no, orr.date
    FROM order_parts_record opr
    JOIN orders_record orr ON opr.order_id = orr.order_id
  `;

  db.query(sql, (error, results) => {
    if (error) {
      console.error("Error fetching production line records:", error);
      return res.status(500).json({ message: "Error fetching records" });
    }

    // Log the results to the terminal
    // console.log("Fetched Order Records:", results);

    res.status(200).json(results);
  });
});

// Production Line
// API to fetch parts
app.get("/api/fetch/production_line", (req, res) => {
  const query = "SELECT * FROM production_line";
  db.query(query, (err, results) => {
    if (err) {
      res.status(500).json({ error: "Failed to fetch records" });
    } else {
      res.json(results);
    }
  });
});

// Production Line request to warehouse
app.post("/api/parts-request/to-warehouse", async (req, res) => {
  const { order_number, selectedParts } = req.body;

  if (!Array.isArray(selectedParts) || selectedParts.length === 0) {
    return res.status(400).json({ error: "No parts selected for request." });
  }

  try {
    // Step 1: Insert into prod_line_requests (main request table)
    const totalRequestedQuantity = selectedParts.reduce(
      (acc, part) => acc + part.total_quantity,
      0
    );

    const requestQuery =
      "INSERT INTO prod_line_requests (product_id, requested_quantity, order_number, status) VALUES (?, ?, ?, ?)";
    const requestResult = await db.query(requestQuery, [
      selectedParts[0].product_id,
      totalRequestedQuantity,
      order_number,
      "pending",
    ]);

    // Extract the insertId
    const requestId = requestResult.insertId;
    if (!requestId) {
      throw new Error("Failed to insert into prod_line_requests");
    }

    // Step 2: Insert each part into the requested_parts table
    const requestDate = new Date(); // Current timestamp
    const batchNos = []; // Collect all batch numbers
    const partQueries = selectedParts.map((part) => {
      batchNos.push(part.batch_no); // Collect batch_no for the WebSocket message
      return db.query(
        "INSERT INTO requested_parts (request_id, product_id, batch_no, quantity_per_piece, total_quantity, request_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          requestId, // Foreign Key to prod_line_requests
          part.product_id,
          part.batch_no,
          part.quantity_per_piece,
          part.total_quantity,
          requestDate,
          "pending",
        ]
      );
    });

    // Wait for all part insert queries to finish
    await Promise.all(partQueries);

    // Notify via WebSocket
    const message = JSON.stringify({
      type: "parts_requested",
      batch_nos: batchNos, // Array of batch numbers
      total_quantity: totalRequestedQuantity, // Aggregate total quantity
      order_number,
      request_date: requestDate, // Send the same request_date
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (wsError) {
          console.error("WebSocket error:", wsError);
        }
      }
    });

    // Step 3: Return success response
    res.status(200).json({
      message: "Parts requested successfully",
      order_number,
      request_id: requestId,
    });
  } catch (error) {
    console.error("Error during request creation:", error.message);
    res.status(500).json({ error: `Internal Server Error: ${error.message}` });
  }
});

// Fetch Pending factory warehouse Notifications
app.get("/api/notifications/factory-warehouse/pending", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT 
          plr.order_number,
          rp.request_date,
          fp.product_name, 
          rp.batch_no,
          ap.part_name,
          rp.total_quantity
      FROM prod_line_requests AS plr
      JOIN requested_parts AS rp ON plr.request_id = rp.request_id
      JOIN factory_products AS fp ON plr.product_id = fp.product_id
      JOIN all_parts AS ap ON rp.batch_no = ap.batch_no
      WHERE plr.status = 'pending'
      ORDER BY rp.request_date DESC;
    `;

    const pendingNotifications = await db.query(query);

    if (!pendingNotifications.length) {
      return res
        .status(200)
        .json({ notifications: [], message: "No pending notifications found" });
    }

    // Aggregate the results into a structured format
    const notificationsMap = {};

    pendingNotifications.forEach((row) => {
      const {
        order_number,
        product_name,
        total_quantity,
        batch_no,
        part_name,
      } = row;

      // Check if the notification already exists in the map
      if (!notificationsMap[order_number]) {
        notificationsMap[order_number] = {
          order_number,
          product_name,
          total_quantity,
          message: `Parts requested for ${product_name}, Order Number: ${order_number}`,
          partsDetails: [],
        };
      }

      // Add parts details for the given order_number
      notificationsMap[order_number].partsDetails.push({
        batch_no,
        part_name,
        quantity: total_quantity,
      });
    });

    // Convert the map into an array
    const notifications = Object.values(notificationsMap);

    res.status(200).json({ notifications });
  } catch (error) {
    console.error("Error fetching pending notifications:", error.message);
    res.status(500).json({ error: `Internal Server Error: ${error.message}` });
  }
});

app.get("/api/requests", (req, res) => {
  const query = `
      SELECT plr.request_id AS request_id, 
             fp.product_name, 
             plr.order_number, 
             COUNT(rp.part_request_id) AS parts_count, 
             DATE_FORMAT(MIN(rp.request_date), '%Y-%m-%d') AS request_date,
             rp.status
      FROM prod_line_requests plr
      JOIN requested_parts rp ON plr.request_id = rp.request_id
      JOIN factory_products fp ON plr.product_id = fp.product_id
      GROUP BY plr.request_id, fp.product_name, plr.order_number, rp.status
      ORDER BY MIN(rp.request_date) DESC;
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error fetching requests:", error.message);
      return res.status(500).json({ error: "Failed to fetch requests." });
    }

    // Convert RowDataPacket to plain objects
    const plainResults = results.map((row) => ({ ...row }));

    res.status(200).json({ data: plainResults });
  });
});

// Fetch specific parts for a given order_number
app.get("/api/requests/:order_number", async (req, res) => {
  const { order_number } = req.params;

  try {
    const query = `
      SELECT rp.part_request_id, rp.batch_no, rp.quantity_per_piece, rp.total_quantity, rp.status
      FROM requested_parts rp
      JOIN prod_line_requests plr ON rp.request_id = plr.request_id
      WHERE plr.order_number = ?
      ORDER BY rp.part_request_id;
    `;

    db.query(query, [order_number], (error, results) => {
      if (error) {
        console.error("Error fetching parts:", error.message);
        return res
          .status(500)
          .json({ error: "Failed to fetch parts for the order." });
      }

      res.status(200).json({ data: results });
    });
  } catch (error) {
    console.error("Error fetching parts:", error.message);
    res.status(500).json({ error: "Failed to fetch parts for the order." });
  }
});

////////// Factory Functionality End //////////

//////////////////// File Upload ////////////////////
// Route to handle file upload and part insertion
app.post("/api/upload", upload.single("file"), (req, res) => {
  const filePath = req.file.path;
  const workbook = xlsx.readFile(filePath);
  const sheetNames = workbook.SheetNames;
  const selectedProduct = req.body.product_id; // This comes from the frontend

  // Check if product exists in the database (based on selected product)
  db.query(
    "SELECT product_id FROM factory_products WHERE product_id = ?",
    [selectedProduct],
    (err, result) => {
      if (err) return res.status(500).send("Database error");

      // If the product doesn't exist, insert it
      if (result.length === 0) {
        const productName = req.body.product_name; // This comes from the frontend as part of the form submission
        db.query(
          "INSERT INTO factory_products (product_name) VALUES (?)",
          [productName],
          (err, result) => {
            if (err) return res.status(500).send("Failed to insert product");

            const productId = result.insertId;

            // Proceed with inserting parts into the database
            insertPartsToDatabase(filePath, productId, res);
          }
        );
      } else {
        const productId = result[0].product_id;

        // Proceed with inserting parts into the database
        insertPartsToDatabase(filePath, productId, res);
      }
    }
  );
});

// Function to insert parts into the database
const insertPartsToDatabase = (filePath, productId, res) => {
  const workbook = xlsx.readFile(filePath);
  const sheetNames = workbook.SheetNames;

  sheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(sheet);

    // For each part in the sheet, insert it into the all_parts and product_parts table
    jsonData.forEach((row) => {
      const { part_name, batch_no, quantity_per_piece } = row;

      // Insert part into all_parts table
      db.query(
        "INSERT INTO all_parts (part_name, batch_no) VALUES (?, ?)",
        [part_name, batch_no],
        (err, result) => {
          if (err) return res.status(500).send("Failed to insert part");

          const partId = result.insertId;

          // Insert part into product_parts table
          db.query(
            "INSERT INTO product_parts (product_id, part_id, qty_per_unit) VALUES (?, ?, ?)",
            [productId, partId, quantity_per_piece],
            (err) => {
              if (err)
                return res
                  .status(500)
                  .send("Failed to associate part with product");
            }
          );
        }
      );
    });
  });

  res.send("File uploaded and data inserted successfully.");
};

app.get("/api/fetch/factory-products", (req, res) => {
  db.query(
    "SELECT product_id AS id, product_name AS name FROM factory_products",
    (err, results) => {
      if (err) {
        return res.status(500).send(err);
      }
      res.json(results);
    }
  );
});

// API to fetch parts for a specific product
app.get("/api/fetch/parts/:productId", (req, res) => {
  const { productId } = req.params;

  const query = `
      SELECT 
          ap.part_id,
          ap.part_name,
          ap.batch_no,
          pp.qty_per_unit
      FROM product_parts pp
      JOIN all_parts ap ON pp.part_id = ap.part_id
      WHERE pp.product_id = ?;
  `;

  db.query(query, [productId], (err, results) => {
    if (err) {
      console.error("Error fetching parts:", err);
      return res.status(500).json({ error: "Failed to fetch parts data." });
    }

    res.json(results);
  });
});
//////////////////// File Upload ////////////////////

//////////////////// Charts ////////////////////
//Factory container records
app.get("/api/fetch/containers-data-by-month", (req, res) => {
  const setGroupConcatLimitQuery =
    "SET SESSION group_concat_max_len = 1000000;";
  const selectQuery = `
SELECT 
    DATE_FORMAT(c.date, '%M') AS month, -- Display full month name
    COUNT(DISTINCT c.container_id) AS total_containers, -- Count unique containers
    SUM(IFNULL(SUM_CONTAINER_PARTS.total_parts, 0)) AS total_parts, -- Total parts for all containers
    GROUP_CONCAT(
        JSON_OBJECT(
            'container_id', c.container_id,
            'container_no', c.container_no,
            'total_parts', IFNULL(SUM_CONTAINER_PARTS.total_parts, 0)
        )
    ) AS container_details
FROM containers c
LEFT JOIN (
    SELECT 
        container_id, 
        SUM(quantity) AS total_parts
    FROM container_parts
    GROUP BY container_id
) AS SUM_CONTAINER_PARTS ON c.container_id = SUM_CONTAINER_PARTS.container_id
GROUP BY DATE_FORMAT(c.date, '%M')
ORDER BY STR_TO_DATE(DATE_FORMAT(c.date, '%M'), '%M') DESC
LIMIT 12;
  `;

  try {
    db.query(setGroupConcatLimitQuery, (err) => {
      if (err) {
        console.error("Error setting group_concat_max_len:", err);
        return res
          .status(500)
          .json({ message: "Error setting session variables" });
      }

      db.query(selectQuery, (err, results) => {
        if (err) {
          console.error("Error fetching monthly data:", err);
          return res.status(500).json({ message: "Error fetching data" });
        }

        const parsedResults = results.map((row) => ({
          month: row.month,
          total_containers: row.total_containers,
          total_parts: row.total_parts,
          container_details: row.container_details
            ? JSON.parse(`[${row.container_details}]`)
            : [],
        }));

        res.status(200).json(parsedResults);
      });
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "An error occurred while fetching data" });
  }
});
//////////////////// Charts End ////////////////////

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: err.message,
  });
});
