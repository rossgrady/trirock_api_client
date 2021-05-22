const express = require('express');
const router = express.Router();
const { main } = require('./api_clients');
const duration = 1814400000; // 3 weeks

router.get('/', async function(req, res, next) {
  const renderObj = {
    title: 'First Pass!',
  }
  res.render('index', renderObj);
});

router.get('/events', async function(req, res, next) {
  const events = await main();
  res.render('events', events);
});

module.exports = router;
