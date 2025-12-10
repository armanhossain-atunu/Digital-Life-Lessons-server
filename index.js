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
        const commentCollection = digital_life_lessons_db.collection('Comments')
        const loveReactCollection = digital_life_lessons_db.collection('LoveReact')
        const favoriteCollection = digital_life_lessons_db.collection('Favorite')
        const sharedCollection = digital_life_lessons_db.collection('Shared')



        // add lessons post
        app.post('/add_lessons', async (req, res) => {
            const lesson = req.body;
            console.log(lesson);
            const result = await addLessonsCollection.insertOne(lesson);
            res.send(result)
        });

        // all lessons get by email
        app.get("/lessons", async (req, res) => {
            const query = {}
            const { email } = req.query;
            if (email) {
                query.authorEmail = email
            }
            const cursor = addLessonsCollection.find(query).sort({ createdAt: -1 })
            const result = await cursor.toArray();
            res.send(result);
        });
        // all lessons get by lesson id
        app.get("/lessons/:id", async (req, res) => {
            const id = req.params;
            const query = { _id: new ObjectId(id) };
            const result = await addLessonsCollection.findOne(query);
            res.send(result);
        });

        // lesson delete by id
        app.delete('/lessons/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await addLessonsCollection.deleteOne(query);
            res.send(result);
        });
        // love react
        app.post('/loveReact/:lessonId', async (req, res) => {
            const lessonId = req.params.lessonId;
            const userEmail = req.body.userEmail;

            if (!userEmail) {
                return res.status(400).send({ message: "userEmail is required" });
            }

            // Find loveReact doc for this lesson
            let doc = await loveReactCollection.findOne({ _id: lessonId });

            // If not existed, create one
            if (!doc) {
                await loveReactCollection.insertOne({
                    _id: lessonId,
                    likedBy: [userEmail]
                });

                return res.send({
                    liked: true,
                    totalLikes: 1
                });
            }

            // Check if the user already liked
            const isLiked = doc.likedBy.includes(userEmail);

            if (isLiked) {
                // UNLIKE
                await loveReactCollection.updateOne(
                    { _id: lessonId },
                    { $pull: { likedBy: userEmail } }
                );
            } else {
                // LIKE
                await loveReactCollection.updateOne(
                    { _id: lessonId },
                    { $addToSet: { likedBy: userEmail } }
                );
            }

            // Fetch updated doc
            const updated = await loveReactCollection.findOne({ _id: lessonId });

            res.send({
                liked: updated.likedBy.includes(userEmail),
                totalLikes: updated.likedBy.length
            });
        });

        // Get love react status
        app.get('/loveReact/:lessonId', async (req, res) => {
            const lessonId = req.params.lessonId;
            const userEmail = req.query.userEmail;

            const doc = await loveReactCollection.findOne({ _id: lessonId });

            if (!doc) {
                return res.send({
                    liked: false,
                    totalLikes: 0
                });
            }

            res.send({
                liked: userEmail ? doc.likedBy.includes(userEmail) : false,
                totalLikes: doc.likedBy.length
            });
        });

        // favorite
        app.post('/favorite/:lessonId', async (req, res) => {
            try {
                const lessonId = req.params.lessonId;
                const userEmail = req.body.userEmail;

                if (!userEmail) {
                    return res.status(400).send({ message: "userEmail is required" });
                }

                const lessonObjectId = new ObjectId(lessonId);

                // Find doc
                let doc = await favoriteCollection.findOne({ lessonId: lessonObjectId });

                // Create if not exists
                if (!doc) {
                    await favoriteCollection.insertOne({
                        lessonId: lessonObjectId,
                        favoritedBy: [userEmail]
                    });

                    return res.send({
                        favorited: true,
                        totalFavorites: 1
                    });
                }

                // Toggle
                const isFavorited = doc.favoritedBy.includes(userEmail);

                if (isFavorited) {
                    await favoriteCollection.updateOne(
                        { lessonId: lessonObjectId },
                        { $pull: { favoritedBy: userEmail } }
                    );
                } else {
                    await favoriteCollection.updateOne(
                        { lessonId: lessonObjectId },
                        { $addToSet: { favoritedBy: userEmail } }
                    );
                }

                const updated = await favoriteCollection.findOne({ lessonId: lessonObjectId });

                res.send({
                    favorited: updated.favoritedBy.includes(userEmail),
                    totalFavorites: updated.favoritedBy.length
                });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // check favorite
        app.get('/checkFavorite', async (req, res) => {
            try {
                const lessonId = req.query.lessonId;
                const userEmail = req.query.userEmail;

                const lessonObjectId = new ObjectId(lessonId);

                const doc = await favoriteCollection.findOne({ lessonId: lessonObjectId });

                if (!doc) {
                    return res.send({
                        favorited: false,
                        totalFavorites: 0
                    });
                }

                res.send({
                    favorited: doc.favoritedBy.includes(userEmail),
                    totalFavorites: doc.favoritedBy.length
                });

            } catch (error) {
                res.send({
                    favorited: false,
                    totalFavorites: 0
                });
            }
        });


        // // shared
        // app.post('/shared', async (req, res) => {
        //     const shared = req.body;
        //     console.log(shared);
        //     const result = await sharedCollection.insertOne(shared);
        //     res.send(result)
        // });
        // post comments
        app.post('/comments', async (req, res) => {
            const comment = req.body;
            console.log(comment);
            const result = await commentCollection.insertOne(comment);
            res.send(result)
        });
        // get comments by postId
        app.get('/comments', async (req, res) => {
            const postId = req.query.postId;
            const comments = await commentCollection
                .find({ postId })
                .sort({ _id: -1 })
                .toArray();

            res.send(comments);

        });
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


