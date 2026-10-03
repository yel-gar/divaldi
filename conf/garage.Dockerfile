# Bootstrap image for the object store.
#
# The Garage image ships a single static binary and nothing else: no shell, no
# curl, no coreutils. That rules out the pattern MinIO allowed, where an `mc`
# image ran a shell script from a mounted volume. This image is busybox with the
# garage binary copied in, which is the smallest thing that gives the init script
# a shell and the CLI.
#
# Note the direction of the copy: busybox is the base and garage comes in from
# upstream, not the other way round. Lifting individual binaries out of busybox
# and dropping them into the distroless Garage image produces an image whose
# shell fails to exec, because those binaries expect a loader and a directory
# layout the Garage image does not have.
FROM busybox:1.37

COPY --from=dxflrs/garage:v2.4.1 /garage /garage

COPY garage-init.sh /init.sh

ENTRYPOINT ["/bin/sh", "/init.sh"]
