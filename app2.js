const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const flash = require('connect-flash');
const helmet = require('helmet');
const https = require('https');
const validator = require('validator');
const bcrypt = require('bcrypt');

const app = express();
const saltRounds = 10;

// Middleware de sécurité
app.use(helmet());

// Configuration des middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuration de la session pour Express
app.use(session({
    secret: 'secret key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true } // Utilisez true en production avec HTTPS
}));

app.use(flash()); // Utilisation de connect-flash pour les messages flash

// Initialisation de Passport
app.use(passport.initialize());
app.use(passport.session());

// Configuration du moteur de vue EJS
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Configuration de la base de données
let db = new sqlite3.Database('./evaluations.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the SQlite database.');
    db.run(`CREATE TABLE IF NOT EXISTS evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folderName TEXT,
        gifName TEXT,
        ranking INTEGER,
        scoreTopRated INTEGER,
        scoreLowestRated INTEGER
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        } else {
            console.log('Table created or already exists.');
            startApp();  // Lancer l'application après la création de la table
        }
    });
});

db.serialize(() => {
    // Créer une table si elle n'existe pas déjà
    db.run(`CREATE TABLE IF NOT EXISTS evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folderName TEXT,
        gifName TEXT,
        ranking INTEGER,
        scoreTopRated INTEGER,
        scoreLowestRated INTEGER
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
            return;
        }
        console.log('Table created or already exists.');
    });

    // Interroger les noms des tables pour vérifier que la création a bien eu lieu
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) {
            console.error('Error fetching tables:', err.message);
            return;
        }
        console.log('Available tables:', tables);
    });
});

function startApp() {
    // Définition des routes
    app.get('/', (req, res) => {
        res.render('home');
    });

    // Route pour démarrer ou continuer les évaluations
    app.get('/evaluation', (req, res) => {
        // Initialisation de la session pour les évaluations si elle n'existe pas
        if (!req.session.evaluations) {
            req.session.evaluations = [];
            req.session.usedIndexes = [];
            req.session.totalEvaluations = 0; // Nombre total d'évaluations effectuées
        }

        // Vérifier si tous les dossiers ont été utilisés
        if (req.session.usedIndexes.length === 100) {
            req.session.usedIndexes = [];  // Réinitialiser les indices une fois que tous ont été utilisés
        }

        // Générer un index de dossier aléatoire qui n'a pas encore été utilisé
        let folderIndex;
        do {
            folderIndex = Math.floor(Math.random() * 100);
        } while (req.session.usedIndexes.includes(folderIndex));

        // Marquer l'index comme utilisé
        req.session.usedIndexes.push(folderIndex);

        // Charger les GIFs
        const folderPath = path.join(__dirname, `data/${String(folderIndex).padStart(3, '0')}`);
        fs.readdir(folderPath, (err, files) => {
            if (err) {
                console.error('Failed to read directory:', err);
                return res.status(500).send('Error loading gifs');
            }

            let gifs = files.filter(file => file.endsWith('.gif'))
                            .map(file => `/serve-gif/${String(folderIndex).padStart(3, '0')}/${file}`);

            // Mélanger les GIFs ici avant de les afficher
            shuffleArray(gifs);

            const prompt = prompts[folderIndex];

            // Ajouter les gifs et le prompt à la session
            req.session.evaluations.push({ prompt, gifs, rankings: [] });
            res.render('evaluation', {
                gifs,
                prompt,
                evaluationsLength: req.session.evaluations.length
            });
        });
    });

    // Route pour traiter les soumissions des évaluations
    app.post('/submit-evaluation', (req, res) => {
        // Validation des entrées
        if (!validator.isInt(req.body.topRatedScore, { min: 0, max: 5 }) || 
            !validator.isInt(req.body.lowestRatedScore, { min: 0, max: 5 })) {
            return res.status(400).send('Invalid score');
        }

        const rankings = req.body.rankOrder ? req.body.rankOrder.split(',').map(Number) : [];
        const topRatedScore = parseInt(req.body.topRatedScore, 10);
        const lowestRatedScore = parseInt(req.body.lowestRatedScore, 10);

        if (req.session.evaluations && req.session.evaluations.length > 0) {
            const lastEvaluation = req.session.evaluations[req.session.evaluations.length - 1];

            // Créer une liste de GIFs avec les indices de leurs positions initiales
            const gifsInfo = lastEvaluation.gifs.map((gif, index) => ({
                gif,
                index: index + 1  // l'index initial avant tout tri
            }));

            // Tri des GIFs selon l'ordre défini par les rankings
            gifsInfo.sort((a, b) => rankings.indexOf(a.index) - rankings.indexOf(b.index));

            // Enregistrement des données triées avec scores conditionnels
            gifsInfo.forEach((item, sortedIndex) => {
                let folderName = path.dirname(item.gif);
                let gifName = path.basename(item.gif);
                let ranking = sortedIndex + 1; 
                let scoreTopRated = sortedIndex === 0 ? topRatedScore : null;
                let scoreLowestRated = sortedIndex === (gifsInfo.length - 1) ? lowestRatedScore : null;

                // Utilisation de requêtes préparées pour éviter les injections SQL
                let stmt = db.prepare(`INSERT INTO evaluations (folderName, gifName, ranking, scoreTopRated, scoreLowestRated) VALUES (?, ?, ?, ?, ?)`);
                stmt.run([folderName, gifName, ranking, scoreTopRated, scoreLowestRated], function(err) {
                    if (err) {
                        return console.error(err.message);
                    }
                    console.log(`A row has been inserted with ranking ${ranking} and score`);
                });
                stmt.finalize();
            });

            // Gestion de la redirection ou de l'affichage de la soumission finale
            if (req.body.action === 'continue') {
                res.redirect('/evaluation');
            } else {
                res.render('final_submission', { evaluations: req.session.evaluations });
                req.session.evaluations = [];
            }
        }
    });

    // Route pour afficher la décision finale
    app.get('/final-decision', (req, res) => {
        if (req.session.evaluations && req.session.evaluations.length >= 3) {
            res.render('final_decision', {
                evaluations: req.session.evaluations,
                batchCount: Math.floor(req.session.evaluations.length / 3),
                continueOption: true
            });
        } else {
            res.redirect('/evaluation');
        }
    });

    // Route pour soumettre les évaluations
    app.get('/submit-evaluations', (req, res) => {
        console.log("Evaluations submitted:", req.session.evaluations);
        req.session.destroy();
        res.send("Evaluations have been submitted. Thank you!");
    });

    // Route pour servir les GIFs de manière contrôlée
    app.get('/serve-gif/:folder/:gifName', (req, res) => {
        const folder = req.params.folder;
        const gifName = req.params.gifName;
        const gifPath = path.join(__dirname, 'data', folder, gifName);

        fs.stat(gifPath, (err, stat) => {
            if (err) {
                console.error('Error accessing file:', gifPath, err);
                return res.status(404).send('GIF not found');
            }

            res.sendFile(gifPath);
        });
    });

    app.get('/export-csv', (req, res) => {
        db.all("SELECT * FROM evaluations", [], (err, rows) => {
            if (err) {
                res.status(400).send("Error fetching records: " + err.message);
                return;
            }
            // Convertir en CSV
            const headers = "Folder Name, GIF Name, Ranking, Score Top Rated, Score Lowest Rated\n";
            const csvContent = rows.map(row => `${row.folderName},${row.gifName},${row.ranking},${row.scoreTopRated},${row.scoreLowestRated}`).join("\n");
            res.header('Content-Type', 'text/csv');
            res.attachment("evaluations.csv");
            res.send(headers + csvContent);
        });
    });

    app.get('/across-lab', isLoggedIn, (req, res) => {
        const dbPath = path.join(__dirname, 'evaluations.db');
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('Error opening database', err.message);
                return res.status(500).send("Error accessing the database");
            }
        });

        db.all("SELECT * FROM evaluations;", [], (err, rows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send("Error fetching records from the database");
            } else {
                res.render('admin', { data: rows });
            }
            db.close((err) => {
                if (err) {
                    console.error('Error closing database', err.message);
                }
            });
        });
    });

    function isLoggedIn(req, res, next) {
        if (req.isAuthenticated()) {
            return next();
        }
        res.redirect('/login');
    }

    app.post('/login', passport.authenticate('local', {
        successRedirect: '/across-lab',
        failureRedirect: '/login',
        failureFlash: 'Invalid username or password.' // Utilisation de flash 
    }));

    app.get('/login', (req, res) => {
        const message = req.flash('error'); // Accès au message flash
        res.render('login', { message: message });
    });

    // Démarrage du serveur HTTPS
    const options = {
        key: fs.readFileSync('path/to/private.key'),
        cert: fs.readFileSync('path/to/certificate.crt')
    };
    https.createServer(options, app).listen(3000, () => {
        console.log('Server running on https://localhost:3000');
    });
}

// Fonction pour mélanger les éléments d'un tableau
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; // Échange des éléments
    }
}