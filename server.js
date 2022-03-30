const express = require('express');
const bodyParser = require('body-parser')
const app = express();
const http = require('http').Server(app);

//local storage
const store = require('store');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}))


// reusable functions
const getTotalParkingTime = (pT, upT) => {
  const parkTime = new Date(pT);
  const unParkTime = new Date(upT)
  let unparkedAfter = (unParkTime.getTime() - parkTime.getTime()) / 1000;

  // for testing 1 hour = 10 secs
  unparkedAfter = Math.round(unparkedAfter/10);
  unparkedAfter = Math.abs(unparkedAfter);

  return unparkedAfter;
}

const getNearestSpace = (map, carData) => {
  const nearestSpace = {};
  for (let i = 0; i < map.length; i++) {
    const entrance = map[i];
      for (let y = 0; y < entrance.length; y++) {
        // check if car fits the space
        const slot = entrance[y];
        if (carData.size < slot.size || carData.size === slot.size ) {
          // check if slot is occupied
          if (slot.car === undefined) {
            // validate if nearest
            if (!nearestSpace.size) {
              nearestSpace.entrance = i;
              nearestSpace.slot = y;
              nearestSpace.size = slot.size;
              nearestSpace.distance = slot.distance;
            } else {
              if (slot.distance < nearestSpace.distance) {
                nearestSpace.entrance = i;
                nearestSpace.slot = y;
                nearestSpace.size = slot.size;
                nearestSpace.distance = slot.distance;
              }
            }
          }
        }
      }
  }
  return nearestSpace;
}


// endpoint for setting the parking space map
app.post('/map', async (req, res) => {
  try {
    const {map} = req.body;

    if (!map)
    throw new Error("missing parameter 'map'")
    
    // check if a valid array
    if (!Array.isArray(map))
      throw new Error('map must be of type array')

    // check number of entry points. must be atleast 3
    if (map.length < 3) {
      throw new Error('map atleast have 3 entry points')
    }

    // store map
    store.set('map', map)
    store.set('cars', []);

    return res.send(store.get('map'))
  } catch (err) {
    res.sendStatus(400);
    return console.log('error',err);
  }
});

// endpoint for setting the parking space map
app.get('/map', async (req, res) => {
  try {
    const map = store.get('map');
    if (!map)
      throw new Error('provide a map first');

    return res.send(map)
  } catch (err) {
    console.log('error',err);
    return res.sendStatus(400);
  }
});

// endpoint parking
app.post('/park', async (req, res) => {
  try {
    const {car, carId} = req.body;
    
    const map = store.get('map');
    if (!map)
      throw new Error('provide a map first');
    
    const cars = store.get('cars');

    // check if reparking
    if (carId !== undefined) {
      // validate type
      if (!Number.isInteger(carId))
        throw new Error ('carId must be of type integer')
      
      const carData = cars.find(car => car.id === carId);

      if (!carData)
        return res.send('no car found');
  
      // check if already unparked
      if (carData.status === 'parked') {
        return res.send('car already parked');
      }

      if (carData.status === 'unparked') {   
        //set to parked status
        carData.status = 'parked';  

        const reparkedAfter = getTotalParkingTime(carData.parkTime, carData.unParkTime);

        if (reparkedAfter > 1) {
          carData.parkTime = new Date();
        }

        // save to cars
        carData.unParkTime = undefined;
        cars[carData.id] = carData;
        store.set('cars', cars);

        // find nearest parking space
        const nearestSpace = getNearestSpace(map, carData);

        if (nearestSpace.entrance === undefined) {
          return res.status(400).send('no available slots');
        }


        // save car to map
        map[nearestSpace.entrance][nearestSpace.slot].car = carData.id;
        store.set('map', map);


        return res.send(store.get('cars'));
      }
    }

    // for first park
    if (car) {
      // check if a valid object
      if (typeof car !== 'object')
        throw new Error('car must be of type object');
    }

    const { name, size } = car;
    
    if (size > 2) 
      throw new Error('car size can only be up to 2');
  
    // generate carId
    const id = store.get('cars').length ? (store.get('cars').length - 1) + 1 : 0;
    // create car data
    const carData = {
      id,
      name,
      size,
      status: 'parked',
      parkTime: new Date()
    }


    // find nearest parking space
    const nearestSpace = getNearestSpace(map, carData);

    if (nearestSpace.entrance === undefined) {
      return res.status(400).send('no available slots');
    }

    // save car data
    carData.parkedAt = nearestSpace;
    cars.push(carData);
    store.set('cars', cars);

    // save car to map
    map[nearestSpace.entrance][nearestSpace.slot].car = carData.id;
    store.set('map', map);


    return res.send(store.get('cars'));
  } catch (err) {
    console.log('error',err);
    return res.sendStatus(400);
  }
});

// endpoint unparking
app.post('/unpark', async (req, res) => {
  try {
    const {carId} = req.body;
    
    if (carId === undefined)
    throw new Error("missing parameter 'carId'");
    // check if a valid object
    if (!Number.isInteger(carId))
      throw new Error('carId must be of type integer');
    
    const map = store.get('map');
    if (!map)
      throw new Error('provide a map first');
    
    const cars = store.get('cars');

    const carData = cars.find(car => car.id === carId);

    if (!carData)
      return res.send('no car found');

    // check if already unparked
    if (carData.status === 'unparked')
      return res.send('car already unparked');
    
    // unpark car
    carData.status = 'unparked';
    carData.unParkTime = new Date();
    cars[carData.id] = carData;
    store.set('cars', cars);

    // save car to map
    const {entrance, slot} = carData.parkedAt;
    map[entrance][slot].car = undefined;
    store.set('map', map);

    // calculate fee
    // initial feee
    let fees = 0;

    // totalParking hours
    let totalParkingTime = getTotalParkingTime(carData.parkTime, carData.unParkTime);


    let calculatedHours = totalParkingTime;

    while(calculatedHours > 0) {
      // every full 24 hour chunk is charged 5,000 pesos regardless of parking slot
      if (calculatedHours > 24 || calculatedHours === 24) {
        fees = fees + 5000;
        calculatedHours = calculatedHours - 24;
      } else {
        // all types of car pay the flat rate of 40 pesos for the first three (3) hours
        if (fees === 0) {
        fees = fees + 40;
          if (calculatedHours < 3 || calculatedHours === 3) {
            calculatedHours = 0;
          } else {
            calculatedHours = calculatedHours - 3;
          }

       }

       // calculate remaining hours
       switch(carData.size) {
         case 0:
           // 20/hour for vehicles parked in SP
           fees = fees + (20 * calculatedHours);
           calculatedHours = 0;
        case 1:
           // 60/hour for vehicles parked in MP
          fees = fees + (60 * calculatedHours);
          calculatedHours = 0;
        case 2:
          // 100/hour for vehicles parked in SP
          fees = fees + (100 * calculatedHours);
          calculatedHours = 0;
       }
      }
    }


    const receipt = {
      carData,
      totalHours: totalParkingTime,
      fees
    }
    
    return res.send(receipt);
  } catch (err) {
    console.log('error',err);
    return res.sendStatus(400);
  }
});

const server = http.listen(3000, () => {
  console.log('server is running on port', server.address().port);
});