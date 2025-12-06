const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require("dotenv").config()
const admin = require("firebase-admin");
const serviceAccount = require("./digital-life-lesson-firebase-adminsdk.json");
const app = express();
const port = process.env.PORT || 3000;


// middleware
app.use(cors());
app.use(express.json())

// mongodb url
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zuak2s6.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});




admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// firebase auth
// const verifyToken = async (req, res, next) => {
//     const authorization = req.headers.authorization;
//     //  const token = authorization.split(" ")[1];
//     //  console.log(token)
//     if (!authorization) {
//         return res.status(401).send({
//             message: "Unauthorized access. Token Not Found",
//         });
//     }
//     const token = authorization.split(" ")[1];
//     try {
//         const decode = await admin.auth().verifyIdToken(token);
//         console.log(decode);
//         next();
//     } catch (error) {
//         res.status(401).send({
//             message: "Unauthorized access",
//         });
//     }
// };

async function run() {
    try {

        // await client.connect()
        const digital_life_lessons_db = client.db('Digital_Life_Lessons')
        const addLessonsCollection = digital_life_lessons_db.collection('Lessons')


        // add lessons post
        app.post('/add_lessons', async (req, res) => {
            const lesson = req.body;
            console.log(lesson);
            const result = await addLessonsCollection.insertOne(lesson);
            res.send(result)

        })

        // all lessons get
        app.get('/lessons', async (req, res) => {
            const query = {};
            const result = await addLessonsCollection.find(query).toArray();
            res.send(result)
        })

        // single item get use id
        // app.get("/transactions/:id", async (req, res) => {
        //     const id = req.params.id;
        //     const result = await transactionsCollection.findOne({
        //         _id: new ObjectId(id),
        //     });
        //     res.send(result);
        // });

        // transactions get by email
        // app.get('/myTransactions', async (req, res) => {
        //     const email = req.query.email;
        //     const query = {}
        //     if (email) {
        //         query.email = email;
        //     }
        //     const result = await transactionsCollection.find(query).toArray();
        //     res.send(result)
        // }
        // )



        //  UPDATE product by id
        // app.put("/myTransactions/update/:id", async (req, res) => {
        //     const { id } = req.params;
        //     const data = req.body;
        //     const objectId = new ObjectId(id)
        //     const result = await transactionsCollection.updateOne({ _id: objectId }, { $set: data });

        //     res.send({
        //         success: true,
        //         result,
        //     });
        // });

        //  DELETE product by id
        app.delete("/transactions/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await transactionsCollection.deleteOne(query);
            res.send(result);
        });



        await client.db('admin').command({ ping: 1 })




    }
    finally {

    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Digital life Lessons server is running')
})
app.listen(port, () => {
    console.log(`Digital Life Lessons Server is running on port ${port}`)
})


