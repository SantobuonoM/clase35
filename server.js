import express from "express";
import cluster from "cluster";
import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
import exphbs from "express-handlebars";
import mongoose from "mongoose";
import * as dotenv from "dotenv"; // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config();
import os from "os";
import fileURLToPath from "url";
import dirname from "path";
import log4js from "log4js";
import compression from "compression";

import { fork } from "child_process";
import minimist from "minimist";
import passport from "passport";
import bCrypt from "bcrypt";
import { Strategy as LocalStrategy } from "passport-local";

const numCPUs = os.cpus().length;
const advancedOptions = { useNewUrlParser: true, useUnifiedTopology: true };

import { User } from "./models/user.js";

const app = express();
const MONGO_DB_URI = process.env.MONGO_URI;

app.use(compression());
app.use(cookieParser());
app.use(
  session({
    store: MongoStore.create({
      mongoUrl: MONGO_DB_URI,
      ttl: 600,
    }),
    secret: "sh",
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      maxAge: 600000,
    },
  })
);

app.engine(
  "hbs",
  exphbs({
    extname: ".hbs",
    defaultLayout: "index.hbs",
  })
);
app.set("view engine", "hbs");
app.set("views", "./views");

//app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  "login",
  new LocalStrategy(
    {
      passReqToCallback: true,
    },
    (req, username, password, cb) => {
      User.findOne({ username: username }, (err, user) => {
        if (err) return done(err);
        if (!user) {
          console.log("User Not Found with username " + username);
          return cb(null, false);
        }
        if (!validatePassword(user, password)) {
          console.log("Invalid Password");
          return cb(null, false);
        }
        return cb(null, user);
      });
    }
  )
);

const validatePassword = (user, password) => {
  return bCrypt.compareSync(password, user.password);
};

passport.use(
  "register",
  new LocalStrategy(
    {
      passReqToCallback: true,
    },
    function (req, username, password, cb) {
      const findOrCreateUser = function () {
        User.findOne({ username: username }, function (err, user) {
          if (err) {
            console.log("Error in SignUp: " + err);
            return cb(err);
          }
          if (user) {
            console.log("User already exists");
            return cb(null, false);
          } else {
            let newUser = new User();
            newUser.username = username;
            newUser.password = createHash(password);
            newUser.save((err) => {
              if (err) {
                console.log("Error in Saving user: " + err);
                throw err;
              }
              console.log("User Registration succesful");
              return cb(null, newUser);
            });
          }
        });
      };
      process.nextTick(findOrCreateUser);
    }
  )
);
const loggerWarn = log4js.getLogger("archivo");

const loggerError = log4js.getLogger("archivo2");

const loggerTodos = log4js.getLogger("todos");

let createHash = function (password) {
  return bCrypt.hashSync(password, bCrypt.genSaltSync(10), null);
};
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser((id, done) => {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

app.get("/ses", (req, res) => {
  console.log(req.session);
  res.send("anda a mirar la consola");
});

app.post(
  "/login",
  passport.authenticate("login", { failureRedirect: "/faillogin" }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/faillogin", (req, res) => {
  res.render("login-error", {});
});

app.get("/register", (req, res) => {
  loggerWarn.warn(`metodo ${req.method} Ruta  ${req.originalUrl}`);
  res.render("register");
});

app.post(
  "/register",
  passport.authenticate("register", { failureRedirect: "/failregister" }),

  (req, res) => {
    res.redirect("/");
  }
);

app.get("/failregister", (req, res) => {
  loggerError.error(`metodo ${req.method} Ruta  ${req.originalUrl}`);
  res.render("register-error", {});
});

app.get("/logout", (req, res, next) => {
  const { username } = req.user;
  req.logout({ username }, (err) => {
    if (err) return next(err);
  });
  res.render("logout", { username });
});

app.get("/login", (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect("/");
  } else {
    res.render("login");
  }
});
app.get("/", (req, res) => {
  loggerTodos.info(`metodo ${req.method} Ruta  ${req.originalUrl}`);
  if (req.isAuthenticated()) {
    res.render("home", { username: req.user.username });
  } else {
    res.redirect("login");
  }
});
/*============================[logs]============================*/
log4js.configure({
  appenders: {
    miLoggerConsole: { type: "console" },
    miLoggerFile: { type: "file", filename: "warn.log" },
    miLoggerFile2: { type: "file", filename: "error.log" },
  },
  categories: {
    default: { appenders: ["miLoggerConsole"], level: "trace" },
    archivo: { appenders: ["miLoggerFile"], level: "warn" },
    archivo2: { appenders: ["miLoggerFile2"], level: "error" },
    todos: { appenders: ["miLoggerConsole", "miLoggerFile2"], level: "info" },
  },
});

/*---------------- RUTAS NUMEROS RANDOM E INFO -------------- */

app.get("/api/randoms", (req, res) => {
  const calculo = fork("randomNumbers.js");
  const num = req.query.cant;
  if (num) {
    console.log(num);
    calculo.on("message", (number) => {
      if (number == "listo") {
        calculo.send(num);
      } else {
        res.json({ number });
      }
    });
  } else {
    calculo.on("message", (number) => {
      if (number == "listo") {
        calculo.send(100000000);
      } else {
        res.json({ number });
      }
    });
  }
});

app.get("/datos", async (req, res) => {
  if (req.user) {
    const datosUsuario = await User.findById(req.user._id).lean();
    res.render("datos", {
      datos: datosUsuario,
    });
  } else {
    res.redirect("/login");
  }
});
app.get("/info", (req, res) => {
  let datos = {
    argumentos: minimist(process.argv.slice(2)),
    plataforma: process.platform,
    versionNode: process.version,
    memoriaReservada: process.memoryUsage(),
    ejecutable: process.execPath,
    pid: process.pid,
    carpetaProyecto: process.cwd(),
    procesadores: numCPUs,
  };

  res.json({ datos });
});

app.get("*", (req, res) => {
  loggerTodos.warn(`metodo ${req.method} Ruta inexistente ${req.originalUrl}`);
  const html = `<div> direccion no valida </div>`;
  res.status(404).send(html);
});

// -------------- MODO FORK -------------------
//pm2 start server.js --name="ServerX" --watch -- PORT
//pm2 start server.js --name="Server1" --watch -- --port 8082
//pm2 start server.js --name="Server2" --watch -- --port 8083
//pm2 start server.js --name="Server3" --watch -- --port 8084
//pm2 start server.js --name="Server4" --watch -- --port 8085

// Tuve un problema que no pude resolver que cuando levanto con fork o cluster los servidores quedan en errored, y no pude encontrar solucion para ese error

// -------------- MODO CLUSTER -------------------
//pm2 start server.js --name="ServerX" --watch -i max -- PORT
//pm2 start server.js --name="Server1" --watch -i max -- --port 8080

//pm2 list
//pm2 delete id

//----------------------------------------------------------------

const argv = minimist(process.argv.slice(2), {
  alias: { p: "port", c: "cluster" },
});

const PORT = argv.p || process.env.PORT;
const CLUSTER = argv.c;

//    --cluster

if (CLUSTER) {
  if (cluster.isPrimary) {
    for (let i = 0; i < CPU_CORES; i++) {
      cluster.fork();
    }
    cluster.on("exit", (worker) => {
      console.log(`Finalizó el worker: ${process.pid}`);
      cluster.fork();
    });
  } else {
    const srv = app.listen(PORT, async () => {
      console.log(
        `Servidor http escuchando en el puerto ${srv.address().port}`
      );
      try {
        const mongo = await mongoose.connect(MONGO_DB_URI, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        });
        console.log("Connected DB");
      } catch (error) {
        console.log(`Error en conexión de Base de datos: ${error}`);
      }
    });
    srv.on("error", (error) => console.log(`Error en servidor ${error}`));
  }
} else {
  const srv = app.listen(PORT, async () => {
    console.log(`Servidor http escuchando en el puerto ${srv.address().port}`);
    try {
      const mongo = await mongoose.connect(MONGO_DB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("Connected DB");
    } catch (error) {
      console.log(`Error en conexión de Base de datos: ${error}`);
    }
  });
  srv.on("error", (error) => console.log(`Error en servidor ${error}`));
}
