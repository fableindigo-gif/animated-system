import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateConnection, getListConnectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CreateConnectionBodyPlatform } from "@workspace/api-client-react";

interface ConnectionDialogProps {
  platform: CreateConnectionBodyPlatform;
  displayName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const schemas = {
  google_ads: z.object({
    developerToken: z.string().min(1, "Developer token is required"),
    accessToken: z.string().min(1, "Access token is required"),
    customerId: z.string().regex(/^\d{3}-\d{3}-\d{4}$/, "Must be format 123-456-7890"),
    managerCustomerId: z.string().optional(),
  }),
  meta: z.object({
    accessToken: z.string().min(1, "Access token is required"),
    adAccountId: z.string().min(1, "Ad account ID is required"),
  }),
  shopify: z.object({
    shopDomain: z.string().regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/, "Must be a .myshopify.com domain"),
    accessToken: z.string().min(1, "Access token is required"),
  }),
  gmc: z.object({
    merchantId: z.string().min(1, "Merchant ID is required"),
    accessToken: z.string().min(1, "Access token is required"),
  }),
  gsc: z.object({
    siteUrl: z.string().min(1, "Site URL is required"),
    accessToken: z.string().min(1, "Access token is required"),
  }),
  // OAuth-only platforms — no manual credential form. These are still listed
  // in the platform enum so users can browse them, but credential entry is
  // routed through the dedicated OAuth dialogs.
  google_workspace: z.object({
    accessToken: z.string().min(1, "Access token is required"),
  }),
  google_sheets: z.object({
    accessToken: z.string().min(1, "Access token is required"),
  }),
};

export function ConnectionDialog({ platform, displayName, isOpen, onOpenChange }: ConnectionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateConnection();

  const form = useForm({
    resolver: zodResolver(schemas[platform]),
    defaultValues: {
      developerToken: "",
      accessToken: "",
      customerId: "",
      managerCustomerId: "",
      adAccountId: "",
      shopDomain: "",
      merchantId: "",
      siteUrl: "",
    },
  });

  const onSubmit = (values: any) => {
    // Filter out empty optional fields and values not relevant to this platform
    const schemaKeys = Object.keys(schemas[platform].shape);
    const credentials = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => schemaKeys.includes(k) && v !== "" && v !== undefined)
    ) as Record<string, string>;

    createMutation.mutate({
      data: {
        platform,
        displayName,
        credentials,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
        toast({
          title: "Connection Saved",
          description: `Successfully connected to ${displayName}.`,
        });
        onOpenChange(false);
        form.reset();
      },
      onError: (error: any) => {
        toast({
          title: "Connection Failed",
          description: error?.message || "An error occurred while saving the connection.",
          variant: "destructive",
        });
      }
    });
  };

  const renderFields = () => {
    switch (platform) {
      case "google_ads":
        return (
          <>
            <FormField
              control={form.control}
              name="developerToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Developer Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} data-testid="input-dev-token" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} data-testid="input-access-token" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer ID</FormLabel>
                  <FormControl>
                    <Input placeholder="123-456-7890" {...field} data-testid="input-customer-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="managerCustomerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Manager Customer ID (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="123-456-7890" {...field} data-testid="input-manager-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case "meta":
        return (
          <>
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} data-testid="input-access-token" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="adAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ad Account ID</FormLabel>
                  <FormControl>
                    <Input placeholder="act_123456789" {...field} data-testid="input-ad-account-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case "shopify":
        return (
          <>
            <FormField
              control={form.control}
              name="shopDomain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Shop Domain</FormLabel>
                  <FormControl>
                    <Input placeholder="mystore.myshopify.com" {...field} data-testid="input-shop-domain" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin API Access Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} data-testid="input-access-token" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case "gmc":
        return (
          <>
            <FormField
              control={form.control}
              name="merchantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Merchant ID</FormLabel>
                  <FormControl>
                    <Input placeholder="123456789" {...field} data-testid="input-merchant-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} data-testid="input-access-token" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case "gsc":
        return (
          <>
            <FormField
              control={form.control}
              name="siteUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Site URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://yoursite.com/" {...field} data-testid="input-site-url" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} data-testid="input-access-token" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect {displayName}</DialogTitle>
          <DialogDescription>
            Enter your credentials to authenticate with {displayName}. Your tokens are securely encrypted.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {renderFields()}
            <div className="pt-4 flex justify-end">
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-connection">
                {createMutation.isPending ? "Connecting..." : "Save Connection"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
