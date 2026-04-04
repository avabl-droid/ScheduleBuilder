const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./db/init');
const { attachSession } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(attachSession);

const frontendFiles = [
  'indexSignUp.html',
  'login.html',
  'profileSetupManager.html',
  'team.html',
  'availability.html',
  'constraints.html',
  'mainSchedule.html',
  'employeeSchedule.html',
  'main.html',
  'scheduleStyles.css',
  'frontend.js',
];

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'indexSignUp.html'));
});

frontendFiles.forEach((file) => {
  app.get(`/${file}`, (_req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});

// Routes
app.use('/api/schedule', require('./routes/scheduleRoutes'));
app.use('/api/team', require('./routes/teamRoutes'));
app.use('/api/auth', require('./routes/loginRoutes'));
app.use('/api/account', require('./routes/accountRoutes'));
app.use('/api/availability', require('./routes/availabilityRoutes'));

app.get('/api/health', (_req, res) => {
  res.send({ status: 'ok' });
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(3000, () => {
      console.log('Server running on port 3000');
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
};
