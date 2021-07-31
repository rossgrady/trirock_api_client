const express = require('express');
const router = express.Router();
const { main, events_add, events_add_json, dblookup_shows } = require('./api_clients');
const util = require('util');
const passport = require('passport');
const tokenStorage = require('../utils/remember-me-token');
const GoogleAuthenticator = require('passport-2fa-totp').GoogeAuthenticator;
const db = require('../db');

const authenticated = function (req, res, next) {
  if (req.isAuthenticated()) {
    console.log('yes you are authenticated congratulations');
    return next();
  }
  return res.redirect('/');
}

router.get('/', function(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/profile');
  }
  var errors = req.flash('error');
  return res.render('index', { 
    errors: errors
  });
});

router.post('/', passport.authenticate('login', {
  failureRedirect: '/',
  failureFlash: true,
  badRequestMessage: 'Invalid username or password.'
}), function (req, res, next) {
  if (!req.body.remember) {
    console.log('missing req.body.remember');
    return res.redirect('/profile');    
  }
  // Create remember_me cookie and redirect to /profile page
  console.log('we checked the remember box so passing req.user to created: ' + util.inspect(req.user, true,3,true));
  tokenStorage.create(req.user, function (err, token) {
    if (err) {
      return next(err);
    }
    res.cookie('remember_me', token, { path: '/', httpOnly: true, maxAge: 604800000 });
    console.log('set cookie, now redirecting to profile');
    return res.redirect('/profile');
  });    
});

/*
router.get('/register', function (req, res, next) {
  var errors = req.flash('error');
  return res.render('register', {
    errors: errors
  });
});

router.post('/register', passport.authenticate('register', {
  successRedirect: '/setup-2fa',
  failureRedirect: '/register',
  failureFlash: true
}));
*/

router.get('/setup-2fa', authenticated, function (req, res, next) {
  var errors = req.flash('setup-2fa-error');
  console.log(errors);
  var qrInfo = GoogleAuthenticator.register(req.user.username);
  console.log(util.inspect(qrInfo, true, 9, true));
  req.session.qr = qrInfo.secret;
  return res.render('setup-2fa', {
    errors: errors,
    qr: qrInfo.qr
  });
});

router.post('/setup-2fa', authenticated, async function (req, res, next) {
  if (!req.session.qr) {
    req.flash('setup-2fa-error', 'The Account cannot be registered. Please try again.');
    return res.redirect('/setup-2fa');
  }
  const dbpool = await db.getPool();
  const querystring1 = "SELECT * from users where id = '" + req.user.id + "'";
  console.log(querystring1);
  try {
    const rows1 = await db.query(dbpool, querystring1);
    if (rows1.length > 0) {
      const querystring2 = "UPDATE users set secret = '" + req.session.qr + "' WHERE id = '" + req.user.id + "'";
      console.log(querystring2);
      try {
        const rows2 = await db.query(dbpool, querystring2);
        res.redirect('/profile');
      } catch (error) {
        console.error(error);
        req.flash('setup-2fa-error', error);
        return res.redirect('/setup-2fa');
      }
    } else {
      req.logout();
      return res.redirect('/');
    }
  } catch (error) {
    console.error(error);
    req.flash('setup-2fa-error', error);
    return res.redirect('/setup-2fa');
  }
});


router.get('/profile', authenticated, function (req, res, next) {
  return res.render("profile", {
    user: req.user
  });
});

router.get('/logout', authenticated, function (req, res, next) {
  tokenStorage.logout(req, res, function () {
    req.logout();
    return res.redirect('/');    
  });
});


router.post('/events-add', authenticated, async function(req, res, next) {
  const processed = await events_add(req.body);
  const dbpool = await db.getPool();
  const events = await dblookup_shows(dbpool, 'array');
  const renderObj = {
    events: events,
  }
  res.render('shows', renderObj);
});

router.post('/events-json', authenticated, async function(req, res, next) {
  const processed = await events_add_json(req.body);
  if (processed) {
    res.status(200);
  }
});

router.get('/events', authenticated, async function(req, res, next) {
  const events = await main();
  const renderObj = {
    events: events,
  }
  res.render('events', renderObj);
});

router.get('/shows', authenticated, async function(req, res, next) {
  const dbpool = await db.getPool();
  const events = await dblookup_shows(dbpool, 'array');
  const renderObj = {
    events: events,
  }
  res.render('shows', renderObj);
});

module.exports = router;
