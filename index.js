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
        const paymentCollection = db.collection('Payments');
        const reportsCollection = db.collection('Reports');


        // =====================================================================
        //                           USER ROUTES
        // =====================================================================


        app.post('/users', async (req, res) => {
            const user = req.body;

            const existingUser = await userCollection.findOne({ email: user.email });

            if (existingUser) {
                return res.send({ message: "User already exists" });
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', async (req, res, next) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });
        app.get('/user', async (req, res) => {
            const email = req.query.email;
            const user = await userCollection.findOne({ email });
            res.send(user);
        });

        // Update user plan (Free / Premium)
        app.put("/updateUserPlan", async (req, res) => {
            const { email, plan } = req.body;

            if (!email || !plan) {
                return res.status(400).send({ message: "Email and plan are required" });
            }

            try {
                // Update user plan
                await userCollection.updateOne(
                    { email },
                    { $set: { plan } }
                );

                // Fetch updated user
                const updatedUser = await userCollection.findOne({ email });

                res.send({ success: true, updatedUser });
            } catch (error) {
                console.error("Plan Update Error:", error.message);
                res.status(500).send({ message: "Failed to update plan" });
            }
        });


        // Update user profile
        app.put("/updateUserProfile", async (req, res) => {
            const { email, displayName, photoURL } = req.body;

            if (!email) return res.status(400).send({ message: "Email is required" });

            try {
                // Update user
                await userCollection.updateOne(
                    { email },
                    { $set: { displayName, photoURL } }
                );

                // Fetch updated user
                const updatedUser = await userCollection.findOne({ email });

                res.send({ success: true, updatedUser });
            } catch (error) {
                console.error("Update Error:", error.message);
                res.status(500).send({ message: "Failed to update profile" });
            }
        })
        // =====================================================================
        //                           PAYMENT API
        // =====================================================================
        app.post("/create-checkout-session", async (req, res) => {
            try {
                const paymentInfo = req.body;
                if (!paymentInfo.price) return res.status(400).send({ message: "Price is required" });

                const amount = Number(paymentInfo.price) * 100;

                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: "USD",
                                unit_amount: amount,
                                product_data: { name: paymentInfo.name },
                            },
                            quantity: paymentInfo.quantity || 1,
                        },
                    ],
                    customer_email: paymentInfo.customer?.email,
                    payment_method_types: ["card"],
                    mode: "payment",
                    success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.CLIENT_URL}/payment-cancel`,
                    metadata: {
                        lessonId: paymentInfo.lessonId,
                        customerEmail: paymentInfo.customer?.email,
                        customerName: paymentInfo.customer?.name,

                    },
                });

                res.send({ url: session.url });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Payment Error", error: error.message });
            }
        });

        //====================================================================
        //                    verify payment using session id
        //====================================================================
        app.get("/verify-payment", async (req, res) => {
            try {
                const { session_id } = req.query;
                if (!session_id) {
                    return res.status(400).send({
                        success: false,
                        message: "Session ID missing",
                    });
                }

                // Retrieve Stripe session
                const session = await stripe.checkout.sessions.retrieve(session_id);
                if (!session) {
                    return res.status(404).send({
                        success: false,
                        message: "Session not found",
                    });
                }

                const isPaid = session.payment_status === "paid";
                const customerEmail = session.metadata.customerEmail;
                const lessonId = session.metadata.lessonId || null;
                const transactionId = session.payment_intent;

                if (!isPaid) {
                    return res.send({
                        success: false,
                        message: "Payment not completed",
                        lessonId,
                        customerEmail,
                    });
                }

                //  DUPLICATE PAYMENT CHECK
                const existingPayment = await paymentCollection.findOne({ transactionId });

                if (existingPayment) {
                    return res.send({
                        success: true,
                        message: "Payment already verified",
                        lessonId: existingPayment.lessonId,
                        customerEmail,
                    });
                }

                //  SAVE PAYMENT TO DB
                await paymentCollection.insertOne({
                    transactionId,
                    customerEmail,
                    lessonId,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    paymentMethod: "card",
                    status: "success",
                    createdAt: new Date(),
                });

                //  UPDATE USER PLAN → PREMIUM
                await userCollection.updateOne(
                    { email: customerEmail, plan: { $ne: "premium" } },
                    {
                        $set: {
                            plan: "premium",
                            isPremium: true,
                            premiumSince: new Date(),
                        },
                    }
                );

                //  RESPONSE
                res.send({
                    success: true,
                    message: "Payment successful! Your plan is now Premium.",
                    lessonId,
                    customerEmail,
                });
            } catch (error) {
                console.error("Verify payment error:", error);
                res.status(500).send({
                    success: false,
                    message: "Verify payment failed",
                });
            }
        });


        app.get('/Payments', async (req, res) => {
            const result = await paymentCollection.find().toArray();
            res.send(result);
        })


        // =====================================================================
        //                           LESSON ROUTES
        // =====================================================================
        // add lesson
        app.post('/add_lessons', async (req, res) => {
            const lesson = req.body;
            const result = await lessonsCollection.insertOne(lesson);
            res.send(result);
        });
        // all lessons
        app.get("/lessons", async (req, res,) => {
            const { email } = req.query;
            const query = email ? { authorEmail: email } : {};

            const result = await lessonsCollection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();

            res.send(result);
        });
        // public lessons
        app.get("/lessons/public", async (req, res) => {
            try {
                const query = { isPublic: "true" };
                const lessons = await lessonsCollection.find(query).toArray();
                const total = await lessonsCollection.countDocuments(query);
                res.send({ total, lessons });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // single id
        app.get("/lessons/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await lessonsCollection.findOne({ _id: new ObjectId(id) });

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Invalid lesson ID" });
            }
        });
        // update
        app.patch("/lessons/:id", async (req, res) => {
            try {
                const { id } = req.params;

                // invalid id check
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid lesson id" });
                }

                const filter = { _id: new ObjectId(id) };

                const updateData = {
                    title: req.body.title,
                    description: req.body.description,
                    access: req.body.access,
                    updatedAt: new Date(),
                };

                // optional image
                if (req.file) {
                    updateData.image = req.file.path;
                }

                const result = await lessonsCollection.updateOne(
                    filter,
                    { $set: updateData }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Lesson not found" });
                }

                res.send({
                    success: true,
                    message: "Lesson updated successfully",
                    result,
                });

            } catch (error) {
                res.status(500).send({ message: "Update failed", error });
            }
        });
        // Delete
        app.delete('/lessons/:id', async (req, res) => {
            const id = req.params.id;
            const result = await lessonsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });
        // Premium Lessons count
        app.get('/premiumLessonsCount', async (req, res) => {
            try {
                const count = await lessonsCollection.countDocuments({ accessLevel: "Premium" });
                res.send({ premiumCount: count });
            } catch (error) {
                res.status(500).send({ message: "Server Error" });
            }
        });
        // Free Lessons count
        app.get('/freeLessonsCount', async (req, res) => {
            try {
                const count = await lessonsCollection.countDocuments({ accessLevel: "Free" });
                res.send({ freeCount: count });
            } catch (error) {
                res.status(500).send({ message: "Server Error" });
            }
        });

        // =====================================================================
        //                      Reports Lessons
        // =====================================================================

        app.post("/lessons/report/:id", async (req, res) => {
            try {
                const lessonId = req.params.id;
                const { reason, reporterEmail } = req.body;

                // Basic validation
                if (!ObjectId.isValid(lessonId)) {
                    return res.status(400).send({ message: "Invalid lesson ID" });
                }

                if (!reason || !reporterEmail) {
                    return res.status(400).send({
                        message: "Reason and reporterEmail are required",
                    });
                }

                const lesson = await lessonsCollection.findOne({
                    _id: new ObjectId(lessonId),
                });

                // Lesson not found
                if (!lesson) {
                    return res.status(404).send({ message: "Lesson not found" });
                }

                // Duplicate report check
                const alreadyReported = lesson.reports?.some(
                    (r) => r.reporterEmail === reporterEmail
                );

                if (alreadyReported) {
                    return res.status(409).send({
                        message: "You already reported this lesson",
                    });
                }

                const report = {
                    reason,
                    reporterEmail,
                    reportedAt: new Date(),
                };

                const result = await lessonsCollection.updateOne(
                    { _id: new ObjectId(lessonId) },
                    {
                        $push: { reports: report },
                        $inc: { reportCount: 1 },
                    }
                );

                res.send({
                    success: true,
                    message: "Lesson reported successfully",
                    result,
                });
            } catch (error) {
                console.error("Report error:", error);
                res.status(500).send({ message: "Server error" });
            }
        });
        app.get("/admin/reported-lessons", async (req, res) => {
            try {
                const lessons = await lessonsCollection
                    .find({ reportCount: { $gt: 0 } })
                    .project({
                        title: 1,
                        reports: 1,
                        reportCount: 1,
                    })
                    .toArray();

                res.send(lessons);
            } catch (error) {
                res.status(500).send({ message: "Failed to load reports" });
            }
        });
        app.patch("/admin/lessons/:lessonId/remove-report", async (req, res) => {
            const { lessonId } = req.params;
            const { reporterEmail } = req.body;

            if (!ObjectId.isValid(lessonId)) {
                return res.status(400).send({ message: "Invalid lesson ID" });
            }

            const result = await lessonsCollection.updateOne(
                { _id: new ObjectId(lessonId) },
                {
                    $pull: { reports: { reporterEmail } },
                    $inc: { reportCount: -1 },
                }
            );

            res.send(result);
        });


        // =====================================================================
        //                      REVIEWS
        // =====================================================================

        app.post("/lessons/:id/review", async (req, res) => {
            try {
                const lessonId = req.params.id;
                const { rating, comment, reviewerEmail } = req.body;

                if (!rating || !comment || !reviewerEmail) {
                    return res.status(400).send({ message: "All fields required" });
                }

                const lesson = await lessonsCollection.findOne({
                    _id: new ObjectId(lessonId),
                });

                if (!lesson) {
                    return res.status(404).send({ message: "Lesson not found" });
                }

                //  Duplicate review check
                const alreadyReviewed = lesson.reviews?.some(
                    (r) => r.reviewerEmail === reviewerEmail
                );

                if (alreadyReviewed) {
                    return res.status(409).send({
                        message: "You already reviewed this lesson",
                    });
                }

                const review = {
                    rating: Number(rating),
                    comment,
                    reviewerEmail,
                    createdAt: new Date(),
                };

                const totalRating =
                    (lesson.averageRating || 0) * (lesson.reviewCount || 0) +
                    Number(rating);

                const newReviewCount = (lesson.reviewCount || 0) + 1;

                const averageRating = totalRating / newReviewCount;

                await lessonsCollection.updateOne(
                    { _id: new ObjectId(lessonId) },
                    {
                        $push: { reviews: review },
                        $set: { averageRating },
                        $inc: { reviewCount: 1 },
                    }
                );

                res.send({ success: true, message: "Review added" });
            } catch (err) {
                res.status(500).send({ message: "Server error" });
            }
        });
        // get reviews
        app.get("/lessons/:id/reviews", async (req, res) => {
            const lesson = await lessonsCollection.findOne(
                { _id: new ObjectId(req.params.id) },
                { projection: { reviews: 1, averageRating: 1, reviewCount: 1 } }
            );

            res.send(lesson || {});
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
        // grt favorite
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

        // get favorite full lessons
        app.get('/favoriteFullLessons', async (req, res) => {
            const email = req.query.email;

            // Step 1: find favorite records
            const favorites = await favoriteCollection.find({
                favoritedBy: email
            }).toArray();

            // Step 2: extract lesson ids
            const lessonIds = favorites.map(f => new ObjectId(f.lessonId));

            // Step 3: find lessons
            const result = await lessonsCollection.find({
                _id: { $in: lessonIds }
            }).toArray();

            res.send(result);
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

    } finally { }
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
