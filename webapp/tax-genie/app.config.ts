export default {
  server: {
    preset: "aws-lambda",
    inlineDynamicImports: true,
    awsLambda: {
      streaming: true,
    },
  },
}
