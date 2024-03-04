const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');

// Allows us to access the .env
require('dotenv').config();

const app = express();
const port = process.env.PORT; // default port to listen

const corsOptions = {
   origin: '*', 
   credentials: true,  
   'access-control-allow-credentials': true,
   optionSuccessStatus: 200,
}

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

app.use(cors(corsOptions));

// Makes Express parse the JSON body of any requests and adds the body to the req object
app.use(bodyParser.json());

app.use(async (req, res, next) => {
  try {
    // Connecting to our SQL db. req gets modified and is available down the line in other middleware and endpoint functions
    req.db = await pool.getConnection();
    req.db.connection.config.namedPlaceholders = true;

    // Traditional mode ensures not null is respected for unsupplied fields, ensures valid JavaScript dates, etc.
    await req.db.query('SET SESSION sql_mode = "TRADITIONAL"');
    await req.db.query(`SET time_zone = '-8:00'`);

    // Moves the request on down the line to the next middleware functions and/or the endpoint it's headed for
    await next();

    // After the endpoint has been reached and resolved, disconnects from the database
    req.db.release();
  } catch (err) {
    // If anything downstream throw an error, we must release the connection allocated for the request
    console.log(err)
    // If an error occurs, disconnects from the database
    if (req.db) req.db.release();
    throw err;
  }
});

// Hashes the password and inserts the info into the `user` table
app.post('/register', async function (req, res) {
  try {
    const { password, username } = req.body;


    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await req.db.query(
      `INSERT INTO person (user_name, user_password)
      VALUES (:username, :hashedPassword);`,
      { username, hashedPassword });

    const jwtEncodedUser = jwt.sign(
      { userId: user.insertId, ...req.body},
      process.env.JWT_KEY
    );

    res.json({ jwt: jwtEncodedUser, success: true });
  } catch (err) {
    console.log('error', err);
    res.json({ err, success: false });
  }
});



app.post('/log-in', async function (req, res) {
  try {
    const { username, password: userEnteredPassword } = req.body;

    const [[user]] = await req.db.query(`SELECT * FROM person WHERE user_name = :username`, { username });

    if (!user) res.json('Username not found');
  
    const hashedPassword = `${user.user_password}`
    const passwordMatches = await bcrypt.compare(userEnteredPassword, hashedPassword);

    if (passwordMatches) {
      const payload = {
        userId: user.id,
        username: user.username,
      }
      
      const jwtEncodedUser = jwt.sign(payload, process.env.JWT_KEY);

      res.json({ jwt: jwtEncodedUser, success: true });
    } else {
      res.json({ err: 'Password is wrong', success: false });
    }
  } catch (err) {
    console.log('Error in /authenticate', err);
  }
});

// Jwt verification checks to see if there is an authorization header with a valid jwt in it.
app.use(async function verifyJwt(req, res, next) {
  const { authorization: authHeader } = req.headers;
  
  if (!authHeader) res.json('Invalid authorization, no authorization headers');

  
  const [scheme, jwtToken] = authHeader.split(' ');

  if (scheme !== 'Bearer') res.json('Invalid authorization, invalid authorization scheme');

  try {
    const decodedJwtObject = jwt.verify(jwtToken, process.env.JWT_KEY);

    req.user = decodedJwtObject;
  } catch (err) {
    console.log(err);
    if (
      err.message && 
      (err.message.toUpperCase() === 'INVALID TOKEN' || 
      err.message.toUpperCase() === 'JWT EXPIRED')
    ) {

      req.status = err.status || 500;
      req.body = err.message;
      req.app.emit('jwt-error', err, req);
    } else {

      throw((err.status || 500), err.message);
    }
  }

  await next();
});




app.post('/workout_tracker_backend', async (req, res) => {
  const { 
    date,
    workout,
    duration
  } = req.body;


  const { userId } = req.user;

  const [insert] = await req.db.query(`
  INSERT INTO workout_tracker (tracker_date, tracker_workout, tracker_duration, user_id)
  VALUES (:date, :workout, :duration, :user_id);
  
  `, { 
    date,
    workout,
    duration,
    user_id: userId,
    deleted_flag: 0
  });


  const [list] = await req.db.query(`SELECT * FROM workout_tracker WHERE user_id = :userId AND deleted_flag = 0;`, { userId });

  // Attaches JSON content to the response
  res.json({list});

});


app.delete('/workout_tracker_backend/:id', async(req, res) => {

  const { 
      id
  } = req.body;
  const { userId } = req.user;

  const [deleted_flag] = await req.db.query(`
  UPDATE workout_tracker SET deleted_flag = 1 WHERE id = :id
`, { id: id });



const [workout_tracker_list] = await req.db.query(`SELECT * FROM workout_tracker WHERE user_id = :userId AND deleted_flag = 0;`, { userId });

  res.json({workout_tracker_list})
})



app.get('/workout_tracker_list', async (req, res) => {
  const { userId } = req.user;

  const [workout_tracker_list] = await req.db.query(`SELECT * FROM workout_tracker WHERE deleted_flag = 0 AND user_id = :userId;`, { userId });

  res.json({ workout_tracker_list });
});




app.put('/update_workout_tracker_entry', async (req, res) => {
  const { id, date, workout, duration } = req.body;
  const { userId } = req.user;

  
  const [update] = await req.db.query(`
  UPDATE workout_tracker
  SET tracker_date = :date,
  tracker_workout = :workout,
  tracker_duration = :duration
  WHERE id = :id
  `, { id, date, workout, duration });
  

  const [list] = await req.db.query(`SELECT * FROM workout_tracker WHERE deleted_flag = 0 AND user_id = :userId;`, { userId });

  res.json({ list });
});



app.get('/fetch-recipe-data', async (req, res) => {
  const [data] = await req.db.query(`SELECT recipe_section_Api_ID , recipe_section_Api_key FROM key_pass`);
  res.json({data });
});



app.get('/fetch-macro-data', async (req, res) => {
  const [data] = await req.db.query(`SELECT macro_calculator_api_id, macro_calculator_api_key FROM key_pass`);
  res.json({data });
});



app.post('/adding_cal_tracker_entry', async (req, res) => {
  
  
  const {
    foodInput, 
    calInput, 
    priceInput, 
    fatInput, 
    carbsInput, 
    proteinInput, } = req.body;
    
    const { userId } = req.user;
    
  const [insert] = await req.db.query(`
  INSERT INTO cal_tracker (
    foodInput, 
    calInput, 
    priceInput, 
    fatInput, 
    carbsInput, 
    proteinInput, 
    user_id)
  VALUES (:foodInput, :calInput, :priceInput, :fatInput, :carbsInput, :proteinInput, :user_id);
  
  `, {
    foodInput, 
    calInput, 
    priceInput, 
    fatInput, 
    carbsInput, 
    proteinInput,
    user_id: userId,
    deleted_flag: 0
  });

  const [list] = await req.db.query(`SELECT * FROM cal_tracker WHERE user_id = :userId AND deleted_flag = 0;`, { userId });

  // Attaches JSON content to the response
  res.json({list});
});



app.post('/savedTotalItemFromCalTracker', async (req, res) => {
  
    
    const { userId } = req.user;

    const [insert] = await req.db.query(`
  INSERT INTO total_from_cal_tracker(
    calTotal, 
    priceTotal, 
    carbsTotal, 
    proteinTotal, 
    fatTotal,
    user_id)
  VALUES (:calTotal, :priceTotal, :carbsTotal, :proteinTotal, :fatTotal, :user_id);
  
  `, {
    calTotal: 0,
    priceTotal: 0,
    carbsTotal: 0,
    proteinTotal: 0,
    fatTotal: 0,
    user_id: userId,
  });

    res.json({});

});




app.put('/updateTotalItemFromCalTracker', async (req, res) => {

  const {calTotal, priceTotal, carbsTotal, proteinTotal, fatTotal} = req.body;
    
    const { userId } = req.user;
    
    const [update] = await req.db.query(`
    UPDATE total_from_cal_tracker
    SET calTotal = :calTotal,
    priceTotal = :priceTotal,
    carbsTotal = :carbsTotal,
    proteinTotal = :proteinTotal,
    fatTotal = :fatTotal
    WHERE user_id = :userId
    `, {calTotal, priceTotal, carbsTotal, proteinTotal, fatTotal, userId});

    res.json({});

});




app.get('/getTotalItemFromCalTracker', async (req, res) => {
  const { userId } = req.user;

  const [total] = await req.db.query(`SELECT * FROM total_from_cal_tracker WHERE user_id = :userId;`, { userId });

  res.json({total});
});



app.get('/cal_tracker_entry_list', async (req, res) => {
  const { userId } = req.user;

  const [list] = await req.db.query(`SELECT * FROM cal_tracker WHERE deleted_flag = 0 AND user_id = :userId;`, { userId });

  res.json({list});
});


app.get('/getUserName', async (req, res) => {
  const { userId } = req.user;

  const [userName] = await req.db.query(`SELECT user_name FROM person WHERE id = :userId;`, { userId });

  res.json({userName});
});



app.delete('/delete_cal_tracker_entry/:id', async(req, res) => {
  const { userId } = req.user;

  const { 
      id
  } = req.body;

  const [deleted_flag] = await req.db.query(`
  UPDATE cal_tracker SET deleted_flag = 1 WHERE id = :id
`, { id: id });

  const [list] = await req.db.query(`SELECT * FROM cal_tracker WHERE deleted_flag = 0 AND user_id = :userId;`, { userId });

  res.json({list});
})


app.post('/water_tracker', async (req, res) => {

  const { userId } = req.user;

  const [insert] = await req.db.query(`
  INSERT INTO water_tracker (waterTarget, waterConsumed, user_id)
  VALUES (:waterTarget, waterConsumed, :user_id);
  
  `, { 
    waterTarget: 0,
    waterConsumed: 0,
    user_id: userId
  });
  

  res.json({});
});


app.put('/updateWaterTarget', async (req, res) => {

  const {waterTarget} = req.body;
    
    const { userId } = req.user;
    
    const [update] = await req.db.query(`
    UPDATE water_tracker
    SET waterTarget = :waterTarget
    WHERE user_id = :userId
    `, {waterTarget, userId});


    const [waterList] = await req.db.query(`SELECT * FROM water_tracker WHERE user_id = :userId;`, { userId });
    res.json({waterList});

});



app.get('/water_tracker_list', async (req, res) => {
  const { userId } = req.user;

  const [waterTargetList] = await req.db.query(`SELECT * FROM water_tracker WHERE user_id = :userId;`, { userId });

  res.json({waterTargetList});
});


app.put('/update_water_tracker_list', async (req, res) => {
  const { userId } = req.user;

  const { waterListId, waterConsumed } = req.body;

  const [prevWaterList] = await req.db.query(`SELECT waterConsumed FROM water_tracker WHERE user_id = :userId;`, { userId });
  const prevWaterConsumed = prevWaterList[0].waterConsumed;

  let totalWater = Number(prevWaterConsumed) + Number(waterConsumed)

  
  const [update] = await req.db.query(`
  UPDATE water_tracker
  SET waterConsumed = :totalWater
  WHERE id = :waterListId
  `, { waterListId, waterConsumed, totalWater});

  const [waterList] = await req.db.query(`SELECT * FROM water_tracker WHERE user_id = :userId;`, { userId });
  res.json({waterList});
});



app.put('/restartWater', async (req, res) => {

  const {waterListId} = req.body;
    
    const { userId } = req.user;
    
    const [update] = await req.db.query(`
    UPDATE water_tracker
    SET waterTarget = :waterTarget,
    waterConsumed = :waterConsumed
    WHERE user_id = :userId AND id = :waterListId
    `, {
      waterTarget: 0,
      waterConsumed: 0, 
      userId,
      waterListId 
    });

    res.json({});

});




app.post('/bmr_bmi_calculator', async (req, res) => {
  const { userId } = req.user;
  
  const 
    {
      bmi, 
      bmr,
      waterIntake, 
      weightGain, 
      weightLoss, 
      tdee, 
      macroRatio,
      proteinMacroRatio,
      fatMacroRatio,
      carbsMacroRatio

    } = req.body;

    console.log({
      bmi, 
      bmr,
      waterIntake, 
      weightGain, 
      weightLoss, 
      tdee, 
      macroRatio,
      proteinMacroRatio,
      fatMacroRatio,
      carbsMacroRatio

    });

  const [prevCalculating] = await req.db.query(`SELECT * FROM bmr_bmi_calculator WHERE user_id = :userId;`, { userId });

  if(prevCalculating.length === 0){

      const [insert] = await req.db.query(`
      INSERT INTO bmr_bmi_calculator (bmr, bmi, weight_gain, weight_loss, tdee, water_intake, macro_ratio, protein_macro_ratio, fat_macro_ratio, carbs_macro_ratio, user_id)
      VALUES (:bmr, :bmi, :weightGain, :weightLoss, :tdee, :waterIntake, :macroRatio, :proteinMacroRatio, :fatMacroRatio, :carbsMacroRatio, :user_id);
      
      `, {
        bmi, 
        bmr,
        waterIntake, 
        weightGain, 
        weightLoss, 
        tdee, 
        macroRatio,
        proteinMacroRatio,
        fatMacroRatio,
        carbsMacroRatio,
        user_id: userId
      });


      res.json({});

  }else{

    const [update] = await req.db.query(`
    UPDATE bmr_bmi_calculator 
    SET bmr = :bmr,
    bmi = :bmi,
    weight_gain = :weightGain,
    weight_loss = :weightLoss,
    tdee = :tdee,
    macro_ratio = :macroRatio,
    protein_macro_ratio = :proteinMacroRatio, 
    fat_macro_ratio = :fatMacroRatio, 
    carbs_macro_ratio = :carbsMacroRatio
    WHERE user_id = :userId
    `, {
      bmi, 
      bmr,
      waterIntake, 
      weightGain, 
      weightLoss, 
      tdee, 
      macroRatio,
      proteinMacroRatio,
      fatMacroRatio,
      carbsMacroRatio,
      userId
    });

    res.json({});

  }

});


app.get('/get_bmr_bmi_calculation', async (req, res) => {
  const { userId } = req.user;

  const [bmiCalculation] = await req.db.query(`SELECT * FROM bmr_bmi_calculator WHERE user_id = :userId;`, { userId });

  res.json({bmiCalculation});
});





// Start the Express server
app.listen(port, () => {
  console.log(`server started at http://localhost:${port}`);
});
