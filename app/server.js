var express    = require('express');
var mysql      = require('mysql');
var dbconfig   = require('./config/database.js');
var conn = mysql.createConnection({
  host     : 'docker_db_1',
  user     : 'root',
  password : '1234',
  port     : 3306,
  database : 'sangsangfarm'
});
var bodyParser = require('body-parser');

var cluster = require('cluster');
var os = require('os');
var uuid = require('uuid');
const port = 3000;
//키생성 - 서버 확인용
var instance_id = uuid.v4();
 
/**
 * 워커 생성
 */
var cpuCount = os.cpus().length; //CPU 수
var workerCount = cpuCount/2; //2개의 컨테이너에 돌릴 예정 CPU수 / 2
console.log('cpu count: '+ cpuCount);
console.log('worker count: '+ cpuCount);

//마스터일 경우
if (cluster.isMaster) {
    console.log('서버 ID : '+instance_id);
    console.log('서버 CPU 수 : ' + cpuCount);
    console.log('생성할 워커 수 : ' + workerCount);
    console.log(workerCount + '개의 워커가 생성됩니다\n');
   
    //워커 메시지 리스너
    var workerMsgListener = function(msg){
       
            var worker_id = msg.worker_id;
           
            //마스터 아이디 요청
            if (msg.cmd === 'MASTER_ID') {
                cluster.workers[worker_id].send({cmd:'MASTER_ID',master_id: instance_id});
            }
    }
   
    //CPU 수 만큼 워커 생성
    for (var i = 0; i < workerCount; i++) {
        console.log("워커 생성 [" + (i + 1) + "/" + workerCount + "]");
        var worker = cluster.fork();
       
        //워커의 요청메시지 리스너
        worker.on('message', workerMsgListener);
    }
   
    //워커가 online상태가 되었을때
    cluster.on('online', function(worker) {
        console.log('워커 온라인 - 워커 ID : [' + worker.process.pid + ']');
    });
   
    //워커가 죽었을 경우 다시 살림
    cluster.on('exit', function(worker) {
        console.log('워커 사망 - 사망한 워커 ID : [' + worker.process.pid + ']');
        console.log('다른 워커를 생성합니다.');
       
        var worker = cluster.fork();
        //워커의 요청메시지 리스너
        worker.on('message', workerMsgListener);
    });
 
//워커일 경우
} else if(cluster.isWorker) {
    var express = require('express');
    var app = express();
    app.use(bodyParser.urlencoded({ extended: false}));
    
    var worker_id = cluster.worker.id;
    var master_id;

    //connecting mysql
    conn.connect(function(err) {
        if (err) {
            console.error('mysql connection error');
            console.error(err);
            throw err;
        }
    });

    //server open 
    var server = app.listen(port, function () {
        console.log("Express 서버가 " + server.address().port + "번 포트에서 Listen중입니다.");
    });
   
    //master_id request from master
    process.send({worker_id: worker_id, cmd:'MASTER_ID'});
    process.on('message', function (msg){
        if (msg.cmd === 'MASTER_ID') {
            master_id = msg.master_id;
        }
    });

    //hello worker
    app.get('/worker', function (req, res) {
        res.send('안녕하세요 저는<br>['+master_id+']서버의<br>워커 ['+ cluster.worker.id+'] 입니다.');
        console.log('유저가 입장했어요')
    });
    
    //get temperature humidity sensor datum
    app.get('/api/sensor/temphumid/:number', (req, res) => {
        const sql = `SELECT deviceID, humid, temp FROM tempHumid \
            ORDER BY time DESC, deviceID ASC LIMIT ${req.params.number}`;
        conn.query(sql, (err, rows, fields) => {
            if(err) {
                console.log(err);
                res.json(err);
            }
            else {
                //sort deviceID
                for(var i =0; i< req.params.number; i++) {
                    for(var j=i+1; j<req.params.number; j++) {
                        if(rows[i].deviceID > rows[j].deviceID) {
                            var temp = rows[j];
                            rows[j] = rows[i];
                            rows[i] = temp;
                        }
                    }
                } 
                console.log(rows.length);
                res.json(rows);
            }
            
        })
    });

    //get temperature humidity sensor datum
    app.get('/api/sensor/temphumid/', (req, res) => {
        const sql = `SELECT deviceID, humid, temp, DATE_FORMAT(time, '%Y년%m월%d일 %H시%i분%s초') as time \
            FROM tempHumid where deviceID=1 ORDER BY time DESC LIMIT 1`;
        conn.query(sql, (err, rows, fields) => {
            if(err) {
                console.log(err);
                res.json(err);
            }
            else {
                //sort deviceID
                console.log(rows.length, rows);
                res.send(`현재시간: ${rows[0].time}</br>\
                    온도는 ${rows[0].temp}도 입니다.</br>\
                    습도는 ${rows[0].humid}% 입니다.`);
            }
            
        })
    });

    //insert temperature humidity sensor datum from arduino or azure sphere
    app.post('/api/sensor/temphumid',  function(req, res) {
        const tempHumid = {
            'deviceID': req.body.deviceID,
            'humid': req.body.humid,
            'temp': req.body.temp
        };
        conn.query('insert into tempHumid set ?', tempHumid, (err, result)=> { 
            var result = {};
            if(err) {
                console.log(err);
                result.success = false;
                res.json(result);
            }
            result.success = true;
            console.log(tempHumid);
            res.json(result);
        });
    });
    
    //kill worker
     app.get("/workerKiller", function (req, res) {
        cluster.worker.kill();
        res.send('워커킬러 호출됨');
    });
}