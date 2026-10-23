-- The household-level credential table was never used: money jars keep their own sealed
-- connections (JarConnection), and Graph tokens live on the sign-in.
DROP TABLE "integration_credential";
