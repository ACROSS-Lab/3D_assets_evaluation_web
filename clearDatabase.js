const sqlite3 = require('sqlite3').verbose();

const dbPath = './evaluations.db';
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        return console.error('Error opening database', err.message);
    }
    console.log('Connected to the SQLite database.');
});

// Supprimer toutes les entrées de la table evaluations
db.run(`DELETE FROM evaluations`, (err) => {
    if (err) {
        console.error('Error deleting data', err.message);
        return;
    }
    console.log('All data has been deleted from the evaluations table.');

    // Réinitialiser le compteur pour les IDs auto-increment
    db.run(`UPDATE sqlite_sequence SET seq = 0 WHERE name = 'evaluations'`, (err) => {
        if (err) {
            console.error('Error resetting auto-increment counter', err.message);
        } else {
            console.log('Auto-increment counter has been reset.');
        }

        // Fermer la base de données
        db.close((err) => {
            if (err) {
                console.error('Error closing database', err.message);
            } else {
                console.log('Database connection closed.');
            }
        });
    });
});
