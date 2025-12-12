const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require("dotenv").config();
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const serviceAccount = require("./digital-life-lesson-firebase-adminsdk.json");
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zuak2s6.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Firebase Auth Middleware
const verifyToken = async (req, res, next) => {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).send({ message: "Unauthorized access. Token Not Found" });
    }

    const token = authorization.split(" ")[1];

    try {
        const decode = await admin.auth().verifyIdToken(token);
        req.decoded = decode; // optional
        next();
    } catch (error) {
        return res.status(401).send({ message: "Unauthorized access" });
    }
};

async function run() {
    try {
        const db = client.db('Digital_Life_Lessons');
        const userCollection = db.collection('Users');
        const lessonsCollection = db.collection('Lessons');
        const commentCollection = db.collection('Comments');
        const loveReactCollection = db.collection('LoveReact');
        const favoriteCollection = db.collection('Favorite');

        // =====================================================================
        //                           USER ROUTES
        // =====================================================================

        app.post('/users', verifyToken, async (req, res, next) => {
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', verifyToken, async (req, res, next) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // get user by email
        app.get('/user', async (req, res) => {
            try {
                const email = req.query.email;
                const user = await userCollection.findOne({ email });
                res.send(user);
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

        // =====================================================================
        //                           PAYMENT API
        // =====================================================================

        app.post("/create-checkout-session", async (req, res) => {
            try {
                const paymentInfo = req.body;
                console.log("Incoming payment:", paymentInfo);

                if (!paymentInfo.price) {
                    return res.status(400).send({ message: "Price is required" });
                }

                const amount = Number(paymentInfo.price) * 100;

                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: "USD",
                                unit_amount: amount,
                                product_data: {
                                    name: paymentInfo.name,
                                    
                                },
                            },
                            quantity: paymentInfo.quantity || 1,
                        },
                    ],
                    customer_email: paymentInfo.customer?.email,
                    payment_method_types: ["card"],
                    mode: "payment",
                    success_url: `${process.env.CLIENT_URL}/payment-success`,
                    cancel_url: `${process.env.CLIENT_URL}/payment-cancel`,
                    metadata: {
                        lessonId: paymentInfo.lessonId,
                        customerEmail: paymentInfo.customer?.email,
                    }
                });

                res.send({ url: session.url });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Payment Error", error: error.message });
            }
        });

        // =====================================================================
        //                           LESSON ROUTES
        // =====================================================================

        app.post('/add_lessons', async (req, res) => {
            const lesson = req.body;
            const result = await lessonsCollection.insertOne(lesson);
            res.send(result);
        });

        app.get("/lessons", async (req, res) => {
            const { email } = req.query;
            const query = email ? { authorEmail: email } : {};

            const result = await lessonsCollection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();

            res.send(result);
        });

        app.get("/lessons/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await lessonsCollection.findOne({ _id: new ObjectId(id) });

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Invalid lesson ID" });
            }
        });

        app.delete('/lessons/:id', async (req, res) => {
            const id = req.params.id;
            const result = await lessonsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // =====================================================================
        //                      LOVE REACT (LIKE) SYSTEM
        // =====================================================================

        app.post('/loveReact/:lessonId', async (req, res) => {
            const lessonId = req.params.lessonId;
            const userEmail = req.body.userEmail;

            if (!userEmail) {
                return res.status(400).send({ message: "userEmail is required" });
            }

            let doc = await loveReactCollection.findOne({ _id: lessonId });

            if (!doc) {
                await loveReactCollection.insertOne({
                    _id: lessonId,
                    likedBy: [userEmail]
                });

                return res.send({ liked: true, totalLikes: 1 });
            }

            const isLiked = doc.likedBy.includes(userEmail);

            if (isLiked) {
                await loveReactCollection.updateOne(
                    { _id: lessonId },
                    { $pull: { likedBy: userEmail } }
                );
            } else {
                await loveReactCollection.updateOne(
                    { _id: lessonId },
                    { $addToSet: { likedBy: userEmail } }
                );
            }

            const updated = await loveReactCollection.findOne({ _id: lessonId });

            res.send({
                liked: updated.likedBy.includes(userEmail),
                totalLikes: updated.likedBy.length
            });
        });

        app.get('/loveReact/:lessonId', async (req, res) => {
            const lessonId = req.params.lessonId;
            const userEmail = req.query.userEmail;

            const doc = await loveReactCollection.findOne({ _id: lessonId });

            if (!doc) {
                return res.send({ liked: false, totalLikes: 0 });
            }

            res.send({
                liked: doc.likedBy.includes(userEmail),
                totalLikes: doc.likedBy.length
            });
        });

        // =====================================================================
        //                      FAVORITE SYSTEM
        // =====================================================================

        app.post('/favorite/:lessonId', async (req, res) => {
            try {
                const lessonId = req.params.lessonId;
                const userEmail = req.body.userEmail;

                if (!userEmail) {
                    return res.status(400).send({ message: "userEmail is required" });
                }

                const lessonObjectId = new ObjectId(lessonId);
                let doc = await favoriteCollection.findOne({ lessonId: lessonObjectId });

                if (!doc) {
                    await favoriteCollection.insertOne({
                        lessonId: lessonObjectId,
                        favoritedBy: [userEmail]
                    });

                    return res.send({ favorited: true, totalFavorites: 1 });
                }

                const isFav = doc.favoritedBy.includes(userEmail);

                if (isFav) {
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
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        app.get('/checkFavorite', async (req, res) => {
            try {
                const lessonId = req.query.lessonId;
                const userEmail = req.query.userEmail;

                const lessonObjectId = new ObjectId(lessonId);
                const doc = await favoriteCollection.findOne({ lessonId: lessonObjectId });

                if (!doc) {
                    return res.send({ favorited: false, totalFavorites: 0 });
                }

                res.send({
                    favorited: doc.favoritedBy.includes(userEmail),
                    totalFavorites: doc.favoritedBy.length
                });

            } catch (error) {
                res.send({ favorited: false, totalFavorites: 0 });
            }
        });

        // =====================================================================
        //                      COMMENTS SYSTEM
        // =====================================================================

        app.post('/comments', async (req, res) => {
            const comment = req.body;
            const result = await commentCollection.insertOne(comment);
            res.send(result);
        });

        app.get('/comments', async (req, res) => {
            const postId = req.query.postId;
            const comments = await commentCollection
                .find({ postId })
                .sort({ _id: -1 })
                .toArray();

            res.send(comments);
        });

    } finally {}
}

run().catch(console.dir);

// Root
app.get('/', (req, res) => {
    res.send('Digital Life Lessons server is running');
});

// Listener
app.listen(port, () => {
    console.log(`Digital Life Lessons Server running on port ${port}`);
});
